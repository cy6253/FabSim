/**
 * 되돌리기 — 값 하나의 역사.
 *
 * 이 앱에서 사람이 고치는 것은 결국 `Project` 하나다. 레시피 노드도, 노브도,
 * 마스크 그림도, 재질 표도 전부 같은 `onChange(project)`로 흐른다. 그래서 되돌리기를
 * 화면마다 따로 둘 이유가 없다 — 여기 한 곳이면 전부 덮인다.
 *
 * 기록은 값을 통째로 담는다. 편집 하나하나를 거꾸로 되돌리는 방식(역연산)은
 * 연산자를 추가할 때마다 짝을 맞춰 줘야 하는데, 그 짝이 하나만 틀려도 되돌리기가
 * 상태를 망가뜨린다. 값을 담으면 그럴 일이 없고, 여기서는 그래도 된다: 프로젝트는
 * 통째로 갈아 끼우는 식으로만 바뀌므로 안 바뀐 부분(마스크 비트, 손 안 댄 노드)은
 * 앞 판과 **같은 객체를 가리킨다**. 60판을 들고 있어도 실제로 늘어나는 것은
 * 바뀐 조각뿐이다.
 */
import { useCallback, useRef, useState } from "react";

/** 들고 있을 판 수. 넘으면 오래된 것부터 버린다. */
const LIMIT = 60;

/**
 * 이만큼 안에 이어진 편집은 한 번으로 묶는다.
 *
 * 슬라이더는 끄는 동안 값을 수십 번 던지고, 숫자칸은 글자마다 던진다. 그것을
 * 그대로 쌓으면 되돌리기 한 번이 한 픽셀만 되돌린다 — 60판이 슬라이더 한 번에
 * 다 차 버린다. 사람이 "한 동작"으로 여기는 것에 맞춰 묶는다.
 */
const COALESCE_MS = 500;

export interface Undoable<T> {
  value: T;
  /** 되돌릴 수 있는 편집. */
  set: (next: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * 역사를 버리고 새로 시작한다.
   *
   * 예제를 열거나 파일을 불러오는 것은 편집이 아니다. 그걸 되돌릴 수 있게 두면
   * 되돌리기가 남의 프로젝트로 데려간다.
   */
  reset: (v: T) => void;
}

export function useUndoable<T>(initial: T | (() => T)): Undoable<T> {
  const [value, setValue] = useState<T>(initial);
  /** 지금 값. 콜백이 최신 값을 보려면 상태가 아니라 이쪽을 읽어야 한다. */
  const cur = useRef<T>(value);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastAt = useRef(0);
  /** 버튼을 켜고 끄려면 깊이가 상태여야 한다. ref만으로는 다시 그리지 않는다. */
  const [depth, setDepth] = useState({ back: 0, fwd: 0 });
  const sync = () => setDepth({ back: past.current.length, fwd: future.current.length });

  const set = useCallback((next: T | ((prev: T) => T)) => {
    const prev = cur.current;
    const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
    if (v === prev) return;
    const now = Date.now();
    // 묶는 것은 **앞 판을 안 쌓는 것**이지 덮어쓰는 것이 아니다. 묶인 구간의
    // 시작점이 그대로 남아 있어야 되돌리기가 그 동작 전체를 되돌린다.
    if (now - lastAt.current > COALESCE_MS) {
      past.current.push(prev);
      if (past.current.length > LIMIT) past.current.shift();
    }
    lastAt.current = now;
    future.current = [];
    cur.current = v;
    setValue(v);
    sync();
  }, []);

  const undo = useCallback(() => {
    const p = past.current.pop();
    if (p === undefined) return;
    future.current.push(cur.current);
    cur.current = p;
    setValue(p);
    // 되돌린 직후의 편집은 반드시 새 판으로 쌓아야 한다 — 안 그러면 방금
    // 되돌린 자리를 덮어써 되돌리기가 한 칸 사라진다.
    lastAt.current = 0;
    sync();
  }, []);

  const redo = useCallback(() => {
    const f = future.current.pop();
    if (f === undefined) return;
    past.current.push(cur.current);
    cur.current = f;
    setValue(f);
    lastAt.current = 0;
    sync();
  }, []);

  const reset = useCallback((v: T) => {
    past.current = [];
    future.current = [];
    lastAt.current = 0;
    cur.current = v;
    setValue(v);
    sync();
  }, []);

  return { value, set, undo, redo, canUndo: depth.back > 0, canRedo: depth.fwd > 0, reset };
}
