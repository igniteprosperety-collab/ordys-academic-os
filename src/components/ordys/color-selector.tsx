import { Check } from "lucide-react";
import { SUBJECT_COLORS } from "@/lib/ordys-db";
import { cn } from "@/lib/utils";

const colorNames = [
  "Grafite", "Ardósia", "Aço", "Azul real", "Azul celeste", "Cobalto",
  "Índigo", "Roxo", "Violeta", "Magenta", "Rosa", "Rosé",
  "Vermelho", "Coral", "Laranja", "Âmbar", "Dourado", "Amarelo",
  "Lima", "Verde", "Esmeralda", "Verde-azulado", "Ciano", "Petróleo",
];

export function ColorSelector({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="grid grid-cols-6 gap-2 sm:grid-cols-8" role="radiogroup" aria-label="Cor da disciplina">
      {SUBJECT_COLORS.map((color, index) => {
        const selected = value === color;
        const name = colorNames[index] ?? `Cor ${index + 1}`;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={name}
            title={name}
            onClick={() => onChange(color)}
            className={cn(
              "grid size-11 place-items-center rounded-full border-2 transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
              selected ? "scale-105 border-foreground" : "border-transparent hover:scale-105",
            )}
            style={{ backgroundColor: color }}
          >
            {selected ? <Check className="size-4 text-primary-foreground drop-shadow" strokeWidth={3} /> : null}
          </button>
        );
      })}
    </div>
  );
}