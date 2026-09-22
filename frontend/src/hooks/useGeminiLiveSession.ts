"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
import { calendarToolDeclarations, executeBackendTool } from "@/lib/tools";
import {
    CALENDAR_REDIRECT_RESPONSE,
    CALENDAR_SYSTEM_INSTRUCTION,
    classifyAssistantTurn,
    isAllowedCalendarTool,
    type ScopeDecision,
} from "@/lib/assistantPolicy";
import { TaskItem } from "@/lib/types";
import { logSafeFailure } from "@/lib/safeLogging";

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
    const [micStream, _setMicStream] = useState<MediaStream | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const setMicStream = useCallback((stream: MediaStream | null) => {
        micStreamRef.current = stream;
        _setMicStream(stream);
    }, []);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const idempotencyKeysRef = useRef<Map<string, string>>(new Map());
    const scopeDecisionRef = useRef<ScopeDecision | null>(null);

    const getStableIdempotencyKey = useCallback(
        (toolName: string, args: Record<string, any>, callId: string) => {
            if (toolName !== "book_event" && toolName !== "cancel_event") return undefined;
            const logicalAction = `${toolName}:${JSON.stringify(args, Object.keys(args).sort())}:${callId}`;
            let key = idempotencyKeysRef.current.get(logicalAction);
            if (!key) {
                key = crypto.randomUUID();
                idempotencyKeysRef.current.set(logicalAction, key);
            }
            return key;
        },
        [],
    );

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

                    systemInstruction: CALENDAR_SYSTEM_INSTRUCTION,

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
                        // Never log model arguments: calendar parameters may contain
                        // attendee details, event titles, or private descriptions.
                        console.log("Received tool call from dormant Gemini path");

                            for (const fc of functionCalls) {
                                if (!fc.name) continue;
                                const callId = fc.id || `call_${Date.now()}`;
                                const args = fc.args || {};
                                const taskItemId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                                const startTime = Date.now();

                                const toolDenied = !isAllowedCalendarTool(fc.name);
                                if (!toolDenied) {
                                    scopeDecisionRef.current = {
                                        action: "allow",
                                        reason: "calendar_intent",
                                        calendarContextActive: true,
                                    };
                                }
                                const idempotencyKey = getStableIdempotencyKey(fc.name, args, callId);

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

                                const execution: Promise<ReturnType<typeof executeBackendTool> extends Promise<infer T> ? T : never> = toolDenied
                                    ? Promise.resolve({
                                          status: "error" as const,
                                          error_code: "POLICY_TOOL_DENIED",
                                          error_message: "That tool is not available.",
                                      })
                                    : executeBackendTool(fc.name, args, idempotencyKey);

                                execution.then((result) => {
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
                                        console.log("Sending tool response from dormant Gemini path");
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
                            console.log("Tool call cancellation requested by dormant Gemini path");
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
                            const decision = classifyAssistantTurn(
                                text,
                                scopeDecisionRef.current?.calendarContextActive ?? false,
                            );
                            scopeDecisionRef.current = decision;

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
                        logSafeFailure("Dormant Gemini voice path failed", error);

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
            setMicStream(stream);

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
            logSafeFailure("Dormant Gemini voice connection failed", error);

            setConnectionStatus("error");
        }
    }, [getStableIdempotencyKey, isMuted, playAudioChunk, setMicStream]);

    const disconnect = useCallback(() => {
        processorRef.current?.disconnect();
        sourceRef.current?.disconnect();

        processorRef.current = null;
        sourceRef.current = null;

        if (micStreamRef.current) {
            micStreamRef.current
                .getTracks()
                .forEach((track) => track.stop());

            setMicStream(null);
        }

        sessionRef.current?.close();
        sessionRef.current = null;

        audioContextRef.current?.close();
        audioContextRef.current = null;

        setIsBotSpeaking(false);
        setIsUserSpeaking(false);
        setConnectionStatus("disconnected");
    }, [setMicStream]);

    // Clean up media streams and session on component unmount
    useEffect(() => {
        return () => {
            disconnect();
        };
    }, [disconnect]);

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

    const handleSpeechStart = useCallback(() => {
        setIsUserSpeaking(true);
    }, []);

    const handleSpeechEnd = useCallback(() => {
        setIsUserSpeaking(false);
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
        micStream,

        connect,
        disconnect,
        toggleMute,
        toggleHandsFree,
        handleInterruption,
        handleSpeechStart,
        handleSpeechEnd,
    };
};
