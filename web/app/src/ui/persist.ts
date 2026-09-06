/**
 * 영속화 — 브라우저를 닫았다 열어도 하던 자리로 돌아온다.
 *
 * 교실에서 쓰는 도구라 이게 없으면 곤란하다. 학생이 실수로 탭을 닫으면 20분치
 * 작업이 날아간다.
 *
 * IndexedDB를 쓴다(결정 ⑥·⑧). localStorage는 5MB 한도가 있고 문자열만 담아서
 * 마스크가 몇 장 들어가면 금세 넘친다. 실패해도 앱은 계속 돌아야 하므로
 * 모든 경로에서 조용히 포기한다 — 사생활 보호 모드나 저장소 차단 설정에서는
 * IndexedDB 자체가 없을 수 있다.
 */
import { validateProject } from "../core/project/serialize";
import type { Project as ProjectType } from "../core/project/types";

const DB = "fabsim3d";
const STORE = "state";
const KEY = "current";
const VERSION = 1;

export interface SavedState {
  /**
   * 프로젝트. 보던 자리는 `project.view`에 들어 있다.
   *
   * 예전에는 단계 번호만 따로 옆에 뒀는데, 그러면 절단면·완화·숨긴 재질은
   * 아무 데도 안 남아 탭을 닫았다 열면 다른 자리에서 시작했다. 시점 전체가
   * 한 곳에 있어야 파일로 내보낸 것과 브라우저에 남은 것이 같은 뜻이 된다.
   */
  project: ProjectType;
  /** 옛 저장분과의 호환용. 새로 쓸 때는 `project.view.step`을 쓴다. */
  step?: number;
  savedAt: number;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

export async function saveState(project: ProjectType): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(
        { project, step: project.view?.step ?? 0, savedAt: Date.now() } satisfies SavedState,
        KEY,
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

/**
 * 저장된 상태를 읽는다. 저장 당시보다 형식이 낡았거나 망가졌으면 null —
 * 그 경우 앱은 기본 예제로 시작한다. 열다가 실패해 빈 화면이 뜨는 것보다 낫다.
 */
export async function loadState(): Promise<SavedState | null> {
  const db = await open();
  if (!db) return null;
  try {
    const raw = await new Promise<unknown>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!raw || typeof raw !== "object") return null;
    const s = raw as SavedState;
    const project = validateProject(s.project);
    // 옛 저장분은 단계를 옆에 들고 있었다. 시점 안으로 옮겨 준다.
    const step = project.view?.step ?? (Number(s.step) || 0);
    return {
      project: { ...project, view: { ...project.view, step } },
      step,
      savedAt: Number(s.savedAt) || 0,
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function clearState(): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}
