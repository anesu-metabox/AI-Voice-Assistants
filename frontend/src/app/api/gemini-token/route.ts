import { NextResponse } from "next/server";
import { GoogleGenAI, Modality } from "@google/genai";

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
        });

        const token = await ai.authTokens.create({
            config: {
                uses: 1,
                expireTime: new Date(
                    Date.now() + 30 * 60 * 1000
                ).toISOString(),
                newSessionExpireTime: new Date(
                    Date.now() + 60 * 1000
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