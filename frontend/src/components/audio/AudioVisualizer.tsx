"use client";

import React, { useEffect, useRef } from "react";
import { AudioVisualizerProps } from "@/lib/types";

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  analyserNode,
  isBotSpeaking = false,
  isUserSpeaking = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    const bufferLength = analyserNode ? analyserNode.frequencyBinCount : 64;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      animationId = requestAnimationFrame(render);

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = 65;

      ctx.clearRect(0, 0, width, height);

      if (analyserNode) {
        analyserNode.getByteFrequencyData(dataArray);
      }

      // Draw glowing background halo
      const gradient = ctx.createRadialGradient(
        centerX,
        centerY,
        radius * 0.5,
        centerX,
        centerY,
        radius * 1.6
      );

      if (isUserSpeaking) {
        gradient.addColorStop(0, "rgba(56, 189, 248, 0.35)"); // Sky blue
        gradient.addColorStop(1, "rgba(56, 189, 248, 0.0)");
      } else if (isBotSpeaking) {
        gradient.addColorStop(0, "rgba(129, 140, 248, 0.4)"); // Indigo / violet
        gradient.addColorStop(1, "rgba(129, 140, 248, 0.0)");
      } else {
        gradient.addColorStop(0, "rgba(51, 65, 85, 0.2)"); // Subtle slate
        gradient.addColorStop(1, "rgba(51, 65, 85, 0.0)");
      }

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 1.6, 0, Math.PI * 2);
      ctx.fill();

      // Draw frequency circular bars
      const numBars = 48;
      const angleStep = (Math.PI * 2) / numBars;

      for (let i = 0; i < numBars; i++) {
        const val = analyserNode ? dataArray[i % bufferLength] / 255 : (Math.sin(Date.now() * 0.003 + i) * 0.1 + 0.15);
        const barHeight = Math.max(4, val * 35);

        const angle = i * angleStep;
        const x1 = centerX + Math.cos(angle) * radius;
        const y1 = centerY + Math.sin(angle) * radius;
        const x2 = centerX + Math.cos(angle) * (radius + barHeight);
        const y2 = centerY + Math.sin(angle) * (radius + barHeight);

        ctx.strokeStyle = isUserSpeaking
          ? `rgba(56, 189, 248, ${0.4 + val * 0.6})`
          : isBotSpeaking
          ? `rgba(168, 85, 247, ${0.4 + val * 0.6})`
          : `rgba(100, 116, 139, 0.4)`;

        ctx.lineWidth = 3;
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Center orb
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 0.85, 0, Math.PI * 2);
      ctx.fillStyle = isUserSpeaking ? "#0284c7" : isBotSpeaking ? "#7c3aed" : "#1e293b";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyserNode, isBotSpeaking, isUserSpeaking]);

  return (
    <div className="relative flex items-center justify-center">
      <canvas
        ref={canvasRef}
        width={320}
        height={320}
        className="rounded-full pointer-events-none"
      />
    </div>
  );
};
