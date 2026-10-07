import { useEffect, useRef, useState } from "react";

export function useStickySummary() {
  const slotRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>();

  useEffect(() => {
    const update = () => {
      const slot = slotRef.current;
      if (!slot || window.innerWidth < 1024) {
        setPinned(false);
        setStyle(undefined);
        return;
      }

      const rect = slot.getBoundingClientRect();
      const shouldPin = rect.top <= 80;
      setPinned(shouldPin);
      setStyle(
        shouldPin
          ? { left: rect.left, top: 80, width: rect.width, position: "fixed" }
          : undefined,
      );
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return { slotRef, pinned, style };
}
