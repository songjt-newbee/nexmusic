import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const ScrollParentContext = createContext<HTMLElement | null>(null);

export function MainScroll({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  return (
    <ScrollParentContext.Provider value={node}>
      <div className="scroll" ref={setNode}>
        {node ? children : null}
      </div>
    </ScrollParentContext.Provider>
  );
}

export function useScrollParent() {
  const node = useContext(ScrollParentContext);
  if (!node) throw new Error("列表需要放在主滚动区域里");
  return node;
}

export function VirtualRows({
  count,
  scrollElement,
  estimateSize = 72,
  overscan = 8,
  focusIndex,
  renderRow,
}: {
  count: number;
  scrollElement: HTMLElement;
  estimateSize?: number;
  overscan?: number;
  focusIndex?: number | null;
  renderRow: (index: number) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
  });
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const margin = list.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop;
    setScrollMargin((prev) => (Math.abs(prev - margin) < 1 ? prev : margin));
  });

  useEffect(() => {
    if (focusIndex == null || focusIndex < 0 || count === 0) return;
    const frame = requestAnimationFrame(() => {
      virtualizerRef.current.scrollToIndex(focusIndex, { align: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusIndex, count]);

  const items = virtualizer.getVirtualItems();
  return (
    <div ref={listRef} style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
      {items.map((item) => (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${item.start - scrollMargin}px)`,
          }}
        >
          {renderRow(item.index)}
        </div>
      ))}
    </div>
  );
}
