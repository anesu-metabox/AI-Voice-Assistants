"use client";

import { useCallback, useRef, useState } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
import { calendarToolDeclarations, executeBackendTool } from "@/lib/tools";
import { TaskItem } from "@/lib/types";

type ConnectionStatus =
    | "disconnected"
    | "connecting"
    | "connected"
    | "error";

export const useGeminiLiveSession = () => {
    const [connectionStatus, setConnectionStatus] =
        useState<ConnectionStatus>("disconnected");

    const [isMuted, setIsMuted] = useState(false);
    const [isHandsFree, setIsHandsFree] = useState(true);
    const [isBotSpeaking, setIsBotSpeaking] = useState(false);
    const [isUserSpeaking, setIsUserSpeaking] = useState(false);

    const [messages, setMessages] = useState<any[]>([]);
    const [tasks, setTasks] = useState<TaskItem[]>([]);

    const sessionRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const nextPlayTimeRef = useRef(0);

    const base64ToInt16 = (base64: string) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        return new Int16Array(bytes.buffer);
    };

    const playAudioChunk = useCallback((base64: string) => {
        const audioContext = audioContextRef.current;

        if (!audioContext) return;

        const pcmData = base64ToInt16(base64);

        const audioBuffer = audioContext.createBuffer(
            1,
            pcmData.length,
            24000
        );

        const channelData = audioBuffer.getChannelData(0);

        for (let i = 0; i < pcmData.length; i++) {
            channelData[i] = pcmData[i] / 32768;
        }

        const source = audioContext.createBufferSource();

        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        const startTime = Math.max(
            audioContext.currentTime,
            nextPlayTimeRef.current
        );

        source.start(startTime);

        nextPlayTimeRef.current =
            startTime + audioBuffer.duration;

        setIsBotSpeaking(true);

        source.onended = () => {
            if (
                audioContext.currentTime >=
                nextPlayTimeRef.current - 0.05
            ) {
                setIsBotSpeaking(false);
            }
        };
    }, []);

    const float32ToBase64PCM = (input: Float32Array) => {
        const pcm = new Int16Array(input.length);

        for (let i = 0; i < input.length; i++) {
            const sample = Math.max(-1, Math.min(1, input[i]));

            pcm[i] =
                sample < 0
                    ? sample * 32768
                    : sample * 32767;
        }

        const bytes = new Uint8Array(pcm.buffer);

        let binary = "";

        const chunkSize = 0x8000;

        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(
                i,
                Math.min(i + chunkSize, bytes.length)
            );

            // @ts-ignore
            binary += String.fromCharCode(...chunk);
        }

        return btoa(binary);
    };

    const connect = useCallback(async () => {
        try {
            setConnectionStatus("connecting");

            // Get short-lived Gemini token
            const tokenResponse = await fetch("/api/gemini-token");

            if (!tokenResponse.ok) {
                throw new Error("Failed to get Gemini token.");
            }

            const { token } = await tokenResponse.json();

            // Create Gemini client
            const ai = new GoogleGenAI({
                apiKey: token,
                httpOptions: { apiVersion: "v1alpha" },
            });

            // Create audio context
            const audioContext = new AudioContext({
                sampleRate: 16000,
            });

            audioContextRef.current = audioContext;

            await audioContext.resume();

            // Connect to Gemini Live
            const session = await ai.live.connect({
                model: "gemini-3.8-live",

                config: {
                    responseModalities: [Modality.AUDIO],

                    inputAudioTranscription: {},
                    outputAudioTranscription: {},

                    systemInstruction:
                        "You are an executive AI voice assistant with real-time access to the user's live calendar and task database. " +
                        "When the user asks what meetings they have, what is on their calendar, or anything about existing bookings, call `list_events`. " +
                        "When the user asks about schedule or availability (free slots), call `get_calendar_availability`. " +
                        "When they want to schedule, book, or reserve a meeting, call `book_event`. " +
                        "When they want to cancel an event, call `cancel_event`. " +
                        "If a conflict occurs, inform them and propose the next available slot. " +
                        "Speak naturally, clearly, and concisely.",

                    tools: [{ functionDeclarations: calendarToolDeclarations }],
                },

                callbacks: {
                    onopen: () => {
                        console.log("Gemini Live connected");
                        setConnectionStatus("connected");
                    },

                    onmessage: (message: any) => {
                        // Handle tool calls from Gemini Live
                        if (message.toolCall?.functionCalls) {
                            const functionCalls = message.toolCall.functionCalls;
                            console.log("Received toolCall from Gemini Live:", functionCalls);

                            for (const fc of functionCalls) {
                                if (!fc.name) continue;
                                const callId = fc.id || `call_${Date.now()}`;
                                const taskItemId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                                const startTime = Date.now();

                                const paramTitle = fc.args?.title || fc.args?.start_date || fc.args?.start_time || "Executing";
                                setTasks((prev) => [
                                    {
                                        id: taskItemId,
                                        title: `${fc.name}: ${paramTitle}`,
                                        toolName: fc.name,
                                        status: "running",
                                        updatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                                    },
                                    ...prev,
                                ]);

                                executeBackendTool(fc.name, fc.args || {}).then((result) => {
                                    const executionDuration = Date.now() - startTime;
                                    const isSuccess = result.status === "success";
                                    const isConflict = result.status === "conflict";
                                    const isConfRequired = result.status === "confirmation_required";

                                    setTasks((prev) =>
                                        prev.map((t) =>
                                            t.id === taskItemId
                                                ? {
                                                      ...t,
                                                      status: isSuccess ? "completed" : isConflict || isConfRequired ? "pending" : "failed",
                                                      output: result.data || result,
                                                      errorMessage: result.error_message || (isConflict ? "Slot Conflict: " + result.error : null),
                                                      executionTimeMs: result.execution_time_ms || executionDuration,
                                                      updatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                                                  }
                                                : t
                                        )
                                    );

                                    if (sessionRef.current) {
                                        console.log("Sending sendToolResponse for callId:", callId, result);
                                        sessionRef.current.sendToolResponse({
                                            functionResponses: [
                                                {
                                                    id: callId,
                                                    name: fc.name,
                                                    response: {
                                                        output: result,
                                                    },
                                                },
                                            ],
                                        });
                                    }
                                });
                            }
                            return;
                        }

                        if (message.toolCallCancellation?.ids) {
                            console.log("Tool call cancellation requested for IDs:", message.toolCallCancellation.ids);
                            return;
                        }

                        const serverContent = message.serverContent;

                        if (!serverContent) return;

                        // User transcript
                        if (
                            serverContent.inputTranscription?.text
                        ) {
                            const text =
                                serverContent.inputTranscription.text;

                            setMessages((prev) => [
                                ...prev,
                                {
                                    id: `user_${Date.now()}`,
                                    speaker: "user",
                                    text,
                                    timestamp:
                                        new Date().toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        }),
                                },
                            ]);

                            setIsUserSpeaking(false);
                        }

                        // Gemini transcript
                        if (
                            serverContent.outputTranscription?.text
                        ) {
                            const text =
                                serverContent.outputTranscription.text;

                            setMessages((prev) => [
                                ...prev,
                                {
                                    id: `assistant_${Date.now()}`,
                                    speaker: "assistant",
                                    text,
                                    timestamp:
                                        new Date().toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        }),
                                },
                            ]);
                        }

                        // Gemini audio
                        const parts =
                            serverContent.modelTurn?.parts || [];

                        for (const part of parts) {
                            if (part.inlineData?.data) {
                                playAudioChunk(part.inlineData.data);
                            }
                        }

                        if (serverContent.turnComplete) {
                            setIsBotSpeaking(false);
                        }
                    },

                    onerror: (error: any) => {
                        console.error(
                            "Gemini Live error:",
                            error
                        );

                        setConnectionStatus("error");
                    },

                    onclose: (event: any) => {
                        console.log(
                            "Gemini Live closed. Code:",
                            event?.code,
                            "Reason:",
                            event?.reason
                        );

                        setConnectionStatus("disconnected");
                    },
                },
            });

            sessionRef.current = session;

            // Get microphone
            const stream =
                await navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                });

            micStreamRef.current = stream;

            // Microphone source
            const source =
                audioContext.createMediaStreamSource(stream);

            sourceRef.current = source;

            // Audio processor
            const processor =
                audioContext.createScriptProcessor(
                    4096,
                    1,
                    1
                );

            processorRef.current = processor;

            processor.onaudioprocess = (event) => {
                if (isMuted) return;

                if (!sessionRef.current) return;

                const input =
                    event.inputBuffer.getChannelData(0);

                const base64Audio =
                    float32ToBase64PCM(input);

                sessionRef.current.sendRealtimeInput({
                    audio: {
                        data: base64Audio,
                        mimeType: "audio/pcm;rate=16000",
                    },
                });
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            setConnectionStatus("connected");
        } catch (error) {
            console.error(
                "Gemini Live connection error:",
                error
            );

            setConnectionStatus("error");
        }
    }, [isMuted, playAudioChunk]);

    const disconnect = useCallback(() => {
        processorRef.current?.disconnect();
        sourceRef.current?.disconnect();

        processorRef.current = null;
        sourceRef.current = null;

        if (micStreamRef.current) {
            micStreamRef.current
                .getTracks()
                .forEach((track) => track.stop());

            micStreamRef.current = null;
        }

        sessionRef.current?.close();
        sessionRef.current = null;

        audioContextRef.current?.close();
        audioContextRef.current = null;

        setIsBotSpeaking(false);
        setIsUserSpeaking(false);
        setConnectionStatus("disconnected");
    }, []);

    const toggleMute = useCallback(() => {
        setIsMuted((current) => {
            const next = !current;

            if (micStreamRef.current) {
                micStreamRef.current
                    .getAudioTracks()
                    .forEach((track) => {
                        track.enabled = !next;
                    });
            }

            return next;
        });
    }, []);

    const toggleHandsFree = useCallback(() => {
        setIsHandsFree((current) => !current);
    }, []);

    const handleInterruption = useCallback(() => {
        setIsBotSpeaking(false);
    }, []);

    return {
        connectionStatus,
        isMuted,
        isHandsFree,
        isBotSpeaking,
        isUserSpeaking,
        latencyMs: 0,
        messages,
        tasks,

        analyserNode: null,
        assistantGainNode: null,
        micStream: micStreamRef.current,

        connect,
        disconnect,
        toggleMute,
        toggleHandsFree,
        handleInterruption,
    };
};