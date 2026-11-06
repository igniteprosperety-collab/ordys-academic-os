import { Download, FileText, Image as ImageIcon, Network, Video, X } from "lucide-react";
import type { ReactElement } from "react";
import type { OrdysAttachment, OrdysAttachmentKind } from "@/lib/ordys-assistant-media";
import type { OrdysConfigurationPlan, OrdysMindMap, OrdysMindMapNode } from "@/lib/ordys-assistant-client";

function attachmentIcon(kind: OrdysAttachmentKind) {
  if (kind === "image") return ImageIcon;
  if (kind === "video") return Video;
  return FileText;
}

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentList({ attachments, onRemove }: { attachments: OrdysAttachment[]; onRemove: (id: string) => void }) {
  if (!attachments.length) return null;
  return (
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
      {attachments.map((attachment) => {
        const Icon = attachmentIcon(attachment.kind);
        return (
          <div key={attachment.id} className="group flex min-w-[180px] items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-2">
            {attachment.dataUrl && attachment.kind === "image" ? <img src={attachment.dataUrl} alt="" className="size-9 shrink-0 rounded-lg object-cover" /> : <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground"><Icon className="size-4" /></span>}
            <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{attachment.name}</span><span className="block text-[9px] text-muted-foreground">{attachment.kind === "video" ? `${attachment.durationSeconds ?? 0}s · quadros` : sizeLabel(attachment.size)}</span></span>
            <button type="button" onClick={() => onRemove(attachment.id)} className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground sm:size-7" aria-label={`Remover ${attachment.name}`}><X className="size-3.5" /></button>
          </div>
        );
      })}
    </div>
  );
}

export function ConfigurationCard({ plan, applying, onApply }: { plan: OrdysConfigurationPlan; applying: boolean; onApply: () => void }) {
  const ready = plan.questions.length === 0 && plan.actions.length > 0;
  return (
    <div className="mt-4 rounded-xl border border-border bg-background p-4">
      <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Network className="size-4" /></span><div className="min-w-0 flex-1"><p className="break-words text-[12px] font-semibold">Configuração preparada</p><p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">{plan.summary || "O Ordys encontrou dados da sua rotina e preparou as alterações abaixo."}</p></div></div>
      <div className="mt-4 space-y-2">{plan.actions.map((action, index) => <div key={`${action.type}-${index}`} className="rounded-lg border border-border bg-surface px-3 py-2.5"><p className="text-[11.5px] font-medium">{action.title}</p><p className="mt-0.5 text-[10px] leading-5 text-muted-foreground">{action.details}</p></div>)}</div>
      {plan.questions.length ? <div className="mt-4 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3"><p className="text-[10.5px] font-semibold text-foreground">Faltam estas informações:</p><div className="mt-1 space-y-1">{plan.questions.map((question, index) => <p key={index} className="text-[10.5px] leading-5 text-muted-foreground">{question}</p>)}</div></div> : null}
      {ready ? <button type="button" onClick={onApply} disabled={applying} className="mt-4 min-h-11 w-full rounded-lg bg-primary px-3 py-2.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-50">{applying ? "Aplicando no ORDYS…" : "Configurar automaticamente no ORDYS"}</button> : null}
    </div>
  );
}

type LayoutNode = { node: OrdysMindMapNode; depth: number; x: number; y: number; width: number; height: number; parent?: number };

function flattenMindMap(root: OrdysMindMap) {
  const nodes: LayoutNode[] = [];
  const columns = [0, 0, 0, 0, 0, 0];
  const xStep = 270;
  const yStep = 96;

  function walk(items: OrdysMindMapNode[], depth: number, parent?: number) {
    items.slice(0, 8).forEach((node) => {
      const index = nodes.length;
      const x = 40 + depth * xStep;
      const column = columns[depth] ?? 0;
      const y = 60 + column * yStep;
      columns[depth] = column + 1;
      nodes.push({
        node,
        depth,
        x,
        y,
        width: depth === 0 ? 230 : 220,
        height: 60,
        ...(parent === undefined ? {} : { parent }),
      });
      if (depth < 5) walk(node.children ?? [], depth + 1, index);
    });
  }

  const rootNode: OrdysMindMapNode = { title: root.title, summary: "", children: root.nodes };
  walk([rootNode], 0);
  const maxDepth = Math.max(...nodes.map((item) => item.depth), 0);
  const width = 80 + (maxDepth + 1) * xStep;
  const height = 120 + Math.max(1, ...columns) * yStep;
  return { nodes, width, height };
}

function escapeXml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] ?? char));
}

function wrapText(text: string, maxChars: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > maxChars && current) {
      lines.push(current);
      current = word;
    } else current = `${current} ${word}`.trim();
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

export function mindMapToSvg(map: OrdysMindMap) {
  const layout = flattenMindMap(map);
  const lines: string[] = [];
  for (const item of layout.nodes) {
    if (item.parent === undefined) continue;
    const parent = layout.nodes[item.parent];
    if (parent) lines.push(`<path d="M ${parent.x + parent.width} ${parent.y + parent.height / 2} C ${parent.x + parent.width + 40} ${parent.y + parent.height / 2}, ${item.x - 40} ${item.y + item.height / 2}, ${item.x} ${item.y + item.height / 2}" fill="none" stroke="#777" stroke-opacity=".28" stroke-width="2"/>`);
  }
  for (const item of layout.nodes) {
    const titleLines = wrapText(item.node.title, 28);
    const summaryLines = wrapText(item.node.summary ?? "", 34);
    lines.push(`<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="14" fill="white" stroke="#777" stroke-opacity=".18"/>`);
    titleLines.forEach((line, index) => lines.push(`<text x="${item.x + 16}" y="${item.y + 23 + index * 15}" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#111">${escapeXml(line)}</text>`));
    summaryLines.slice(0, 2).forEach((line, index) => lines.push(`<text x="${item.x + 16}" y="${item.y + 45 + index * 13}" font-family="Arial, sans-serif" font-size="9" fill="#555">${escapeXml(line)}</text>`));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}"><rect width="100%" height="100%" fill="white"/>${lines.join("")}</svg>`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(title: string, fallback: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || fallback;
}

export function MindMapCard({ map }: { map: OrdysMindMap }) {
  const { nodes, width, height } = flattenMindMap(map);
  const svg = mindMapToSvg(map);
  const filename = safeFilename(map.title || "mapa-mental", "mapa-mental");

  function downloadSvg() {
    downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${filename}.svg`);
  }

  async function downloadPng() {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Não foi possível preparar a imagem PNG.")); image.src = url; });
      const scale = Math.max(1, Math.min(2, 1800 / Math.max(width, 1)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Seu dispositivo não conseguiu preparar o PNG.");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Não foi possível gerar o PNG.");
      downloadBlob(blob, `${filename}.png`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-secondary text-primary"><Network className="size-4" /></span><div><p className="text-[12px] font-semibold">{map.title}</p><p className="text-[9.5px] text-muted-foreground">Mapa mental estruturado pelo conteúdo enviado.</p></div></div>
        <div className="flex gap-2"><button type="button" onClick={downloadPng} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-[10px] font-medium hover:bg-secondary"><ImageIcon className="size-3.5" /> Baixar PNG</button><button type="button" onClick={downloadSvg} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-[10px] font-medium hover:bg-secondary"><Download className="size-3.5" /> SVG</button></div>
      </div>
      <div className="mt-4 w-full max-w-full min-w-0 overflow-hidden rounded-lg border border-border bg-white p-2">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full max-w-full" role="img" aria-label={`Mapa mental: ${map.title}`}>
          <g>{layoutForPreview(nodes)}</g>
        </svg>
      </div>
    </div>
  );
}

function layoutForPreview(nodes: LayoutNode[]) {
  const pieces: ReactElement[] = [];
  for (const item of nodes) {
    if (item.parent !== undefined) {
      const parent = nodes[item.parent];
      if (parent) pieces.push(<path key={`p-${item.parent}-${item.x}-${item.y}`} d={`M ${parent.x + parent.width} ${parent.y + parent.height / 2} C ${parent.x + parent.width + 40} ${parent.y + parent.height / 2}, ${item.x - 40} ${item.y + item.height / 2}, ${item.x} ${item.y + item.height / 2}`} fill="none" stroke="currentColor" strokeOpacity=".28" strokeWidth="2" />);
    }
    pieces.push(<rect key={`r-${item.x}-${item.y}`} x={item.x} y={item.y} width={item.width} height={item.height} rx="14" fill="white" stroke="currentColor" strokeOpacity=".18" />);
    wrapText(item.node.title, 28).forEach((line, index) => pieces.push(<text key={`t-${item.x}-${item.y}-${index}`} x={item.x + 16} y={item.y + 23 + index * 15} fontSize="13" fontWeight="700" fill="currentColor">{line}</text>));
    wrapText(item.node.summary ?? "", 34).slice(0, 2).forEach((line, index) => pieces.push(<text key={`s-${item.x}-${item.y}-${index}`} x={item.x + 16} y={item.y + 45 + index * 13} fontSize="9" fill="currentColor" opacity=".62">{line}</text>));
  }
  return pieces;
}
