/**
 * Die Primitive aus Abschnitt 9 des Gestaltungssystems.
 *
 * Bewusst eigene Bausteine statt einer Bibliothek von der Stange: Das
 * Aussehen kommt aus `meinbaulotse-ci.md`, nicht aus einer Voreinstellung.
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'field';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-button)] ' +
  'font-medium transition-[transform,background-color,border-color] ' +
  'duration-[var(--motion-micro)] ease-[var(--ease-standard)] ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-midnight-ink text-canvas-white shadow-[var(--shadow-subtle)] hover:bg-charcoal',
  outline: 'bg-canvas-white text-charcoal border border-ash hover:bg-paper-mist',
  ghost: 'bg-transparent text-charcoal hover:bg-paper-mist',
  danger: 'bg-canvas-white text-alarm-red border border-alarm-red hover:bg-soft-red',
};

/**
 * `field` ist die Größe für alles, was auf der Baustelle bedient wird.
 * Abschnitt 5.4 der Spezifikation verlangt Bedienbarkeit mit Handschuhen;
 * 36 Pixel sind das nicht.
 */
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-body',
  md: 'h-11 px-4 text-body',
  field: 'h-14 px-6 text-body-lg',
};

export function Button({
  variant = 'outline',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      {...props}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
    />
  );
}

export function Card({
  children,
  className = '',
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'muted';
}) {
  // Kanten statt Schatten: Der Standardbehälter definiert sich über 1 px Ash.
  const styles =
    tone === 'muted'
      ? 'bg-paper-mist rounded-[var(--radius-large)]'
      : 'bg-canvas-white border border-ash rounded-[var(--radius-card)]';
  return <section className={`${styles} p-4 ${className}`}>{children}</section>;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      {/* Beschriftung über dem Feld, nie als Platzhalter: Platzhalter
          verschwinden beim Tippen, und dann weiß niemand mehr, was er eingibt. */}
      <span className="text-body font-medium text-charcoal">{label}</span>
      {children}
      {error !== undefined ? (
        <span className="text-caption text-alarm-red">{error}</span>
      ) : hint !== undefined ? (
        <span className="text-caption text-steel">{hint}</span>
      ) : null}
    </label>
  );
}

// Der schwarze Rand ist die Signatur der Referenz: Felder wirken wichtig,
// nicht optional. 16 px Schriftgröße, weil iOS darunter ungefragt hineinzoomt.
const CONTROL =
  'rounded-[var(--radius-input)] border border-midnight-ink bg-canvas-white ' +
  'px-3 text-charcoal placeholder:text-fog';

// Größe und Breite gehören zur Variante, nicht in ein durchgereichtes
// className: Zwei Tailwind-Klassen für dieselbe Eigenschaft entscheiden sich
// nach der Reihenfolge im Stylesheet, nicht nach der im Attribut. Wer `h-9`
// anhängt, um `h-11` zu überschreiben, bekommt ein Ergebnis, das vom
// Bündelvorgang abhängt.
//
// Sie heißt `density` und nicht `size`, weil `size` auf `input` und `select`
// bereits ein HTML-Attribut mit anderer Bedeutung ist.
const CONTROL_DENSITY = {
  default: 'h-11 w-full text-body-lg',
  compact: 'h-9 w-auto text-body',
} as const;

type ControlDensity = keyof typeof CONTROL_DENSITY;

export function TextInput({
  density = 'default',
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { density?: ControlDensity }) {
  return <input {...props} className={`${CONTROL} ${CONTROL_DENSITY[density]} ${className}`} />;
}

export function Select({
  density = 'default',
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { density?: ControlDensity }) {
  return <select {...props} className={`${CONTROL} ${CONTROL_DENSITY[density]} ${className}`} />;
}

type PillTone = 'neutral' | 'blue' | 'green' | 'amber' | 'violet' | 'red';

const PILL_TONES: Record<PillTone, string> = {
  neutral: 'bg-paper-mist text-steel',
  blue: 'bg-soft-blue text-electric-blue',
  green: 'bg-soft-mint text-vivid-green',
  amber: 'bg-soft-amber text-tangerine',
  violet: 'bg-soft-violet text-lavender',
  red: 'bg-soft-red text-alarm-red',
};

export function Pill({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: PillTone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-caption font-medium ${PILL_TONES[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * Merkmalspille — das Signaturelement der Referenz. Je Abschnitt genau ein
 * Akzent, siehe CI 3.5.
 */
export function SectionPill({
  tone,
  icon,
  children,
}: {
  tone: PillTone;
  icon: ReactNode;
  children: ReactNode;
}) {
  const accent: Record<PillTone, string> = {
    neutral: 'text-steel',
    blue: 'text-electric-blue',
    green: 'text-vivid-green',
    amber: 'text-tangerine',
    violet: 'text-lavender',
    red: 'text-alarm-red',
  };
  return (
    <span className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] py-2 text-body font-medium text-charcoal">
      <span className={accent[tone]}>{icon}</span>
      {children}
    </span>
  );
}

export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  // Kein Bild, keine Illustration, kein aufmunternder Spruch — ein Satz, der
  // sagt, was hier stehen wird, und eine Aktion, die dorthin führt.
  return (
    <div className="flex flex-col items-start gap-3 py-8">
      <p className="max-w-[34rem] text-body text-steel">{text}</p>
      {action}
    </div>
  );
}
