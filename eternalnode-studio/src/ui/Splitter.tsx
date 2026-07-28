/**
 * ui/Splitter.tsx
 * Drag handle for resizable panels. Vertical splitters resize the panel to
 * their left/right, horizontal ones the panel above/below.
 */

import { useCallback } from 'react';

interface Props {
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  onChange: (value: number) => void;
}

export function Splitter({ orientation, value, min, max, invert, onChange }: Props): JSX.Element {
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startPos = orientation === 'vertical' ? e.clientX : e.clientY;
      const startValue = value;
      const move = (ev: PointerEvent) => {
        const pos = orientation === 'vertical' ? ev.clientX : ev.clientY;
        const delta = (pos - startPos) * (invert ? -1 : 1);
        onChange(Math.min(max, Math.max(min, startValue + delta)));
      };
      const up = () => window.removeEventListener('pointermove', move);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
    },
    [orientation, value, min, max, invert, onChange],
  );

  return (
    <div
      className={`splitter splitter--${orientation}`}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={orientation}
    />
  );
}
