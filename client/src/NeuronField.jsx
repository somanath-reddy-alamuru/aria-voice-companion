import { useEffect, useRef } from "react";

// A lightweight animated "neuron" field: drifting nodes, connections between
// nearby nodes, and occasional pulses that travel along an edge — like a
// tiny neural net idly firing. Speed/glow/color react to Aria's state so the
// whole background reads as part of the UI, not just decoration.
const PALETTE = {
  idle: { node: "137,148,175", edge: "80,92,120", glow: 0.35, speed: 0.18, pulseRate: 0.002 },
  listening: { node: "79,209,197", edge: "60,150,145", glow: 0.75, speed: 0.4, pulseRate: 0.01 },
  thinking: { node: "242,184,75", edge: "170,120,50", glow: 0.65, speed: 0.55, pulseRate: 0.02 },
  speaking: { node: "242,184,75", edge: "180,130,55", glow: 0.9, speed: 0.7, pulseRate: 0.035 },
};

export default function NeuronField({ state = "idle" }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  const nodesRef = useRef([]);
  const pulsesRef = useRef([]);
  const rafRef = useRef(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let width, height, dpr;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.max(28, Math.min(70, Math.floor((width * height) / 22000)));
      nodesRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: 1.2 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    resize();
    window.addEventListener("resize", resize);

    const LINK_DIST = 150;

    function step() {
      const palette = PALETTE[stateRef.current] || PALETTE.idle;
      ctx.clearRect(0, 0, width, height);

      const nodes = nodesRef.current;
      for (const n of nodes) {
        n.x += n.vx * palette.speed;
        n.y += n.vy * palette.speed;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
        n.phase += 0.02;
      }

      // Edges between nearby nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK_DIST) {
            const alpha = (1 - dist / LINK_DIST) * palette.glow * 0.4;
            ctx.strokeStyle = `rgba(${palette.edge},${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            // occasionally spawn a pulse traveling along this edge
            if (Math.random() < palette.pulseRate * 0.02) {
              pulsesRef.current.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, t: 0 });
            }
          }
        }
      }

      // Traveling pulses (little bright dots sliding along an edge)
      pulsesRef.current = pulsesRef.current.filter((p) => p.t < 1);
      for (const p of pulsesRef.current) {
        p.t += 0.02;
        const x = p.ax + (p.bx - p.ax) * p.t;
        const y = p.ay + (p.by - p.ay) * p.t;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${palette.node},${0.9 * (1 - p.t)})`;
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Nodes (gentle pulsing glow)
      for (const n of nodes) {
        const pulse = 0.6 + 0.4 * Math.sin(n.phase);
        const alpha = palette.glow * pulse;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${palette.node},${alpha})`;
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} className="neuron-field" aria-hidden="true" />;
}
