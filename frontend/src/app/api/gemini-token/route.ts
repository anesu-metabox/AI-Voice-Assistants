import { NextResponse } from "next/server";
import { GoogleGenAI, Modality } from "@google/genai";

async function getGoogleServerTime(): Promise<number> {
    try {
        const res = await fetch("https://generativelanguage.googleapis.com", {
            method: "HEAD",
            cache: "no-store",
        });
        const serverDate = res.headers.get("date");
        if (serverDate) {
            const serverMs = new Date(serverDate).getTime();
            if (!isNaN(serverMs)) {
                return serverMs;
            }
        }
    } catch (err) {
        console.warn("Failed to get Google server time header, falling back to local time:", err);
    }
    return Date.now();
}

export async function GET() {
    try {
        let apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "GEMINI_API_KEY or GOOGLE_API_KEY is not configured." },
                { status: 500 }
            );
        }
        apiKey = apiKey.replace(/^["']|["']$/g, '').trim();

        const ai = new GoogleGenAI({
            apiKey: apiKey,
            httpOptions: { apiVersion: "v1alpha" },
        });

        // Use authoritative Google server time to prevent clock skew / expired token errors (1011)
        const serverNow = await getGoogleServerTime();

        const token = await ai.authTokens.create({
            config: {
                uses: 1,
                expireTime: new Date(
                    serverNow + 30 * 60 * 1000
                ).toISOString(),
                newSessionExpireTime: new Date(
                    serverNow + 5 * 60 * 1000
                ).toISOString(),
                liveConnectConstraints: {
                    model: "gemini-3.8-live",
                    config: {
                        responseModalities: [Modality.AUDIO],
                        inputAudioTranscription: {},
                        outputAudioTranscription: {},
                    },
                },
            },
        });

        return NextResponse.json({
            token: token.name,
        });
    } catch (error) {
        console.error("Gemini token error:", error);

        return NextResponse.json(
            { error: "Failed to create Gemini token." },
            { status: 500 }
        );
    }
}