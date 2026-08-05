import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  activeDeclarations,
  toConstraint,
  withDeclaration,
  withResolved,
  type DeclarationsRead,
  type TissueDeclaration,
} from "@engine/tissue-declare.ts";
import type { TissueConstraint, TissueProvocation, TissueSite, TissueStatus } from "@engine/tissue.ts";
import { decodeDeclarations, encodeDeclarations } from "./health-codec";
import { localToday } from "./store";

/**
 * The phone's tissue declarations — structured injury caps, on-device.
 *
 * Offline by construction, like the pain log. The validation, the active-set
 * resolution and the mapping to the engine's TissueConstraint are all
 * engine/tissue-declare.ts, shared with the dashboard, so a declaration means
 * the same thing on both surfaces and neither invents a cap of its own.
 *
 * Storage that will not parse reads as UNREADABLE, never absent, and callers
 * on the automatic path must refuse to re-plan rather than quietly drop an
 * injured athlete's limits (E9). readTissueConstraints returns that status so
 * the reconcile can.
 */

const KEY = "taper.tissue.v1";

let snapshot: DeclarationsRead | null = null;

export async function readDeclarations(): Promise<DeclarationsRead> {
  if (snapshot) return snapshot;
  snapshot = decodeDeclarations(await AsyncStorage.getItem(KEY).catch(() => null));
  return snapshot;
}

export interface TissueRead {
  constraints: TissueConstraint[];
  active: TissueDeclaration[];
  status: DeclarationsRead["status"];
  message?: string;
}

/** The constraints binding today, plus the read status the reflow must honour. */
export async function readTissue(today = localToday()): Promise<TissueRead> {
  const read = await readDeclarations();
  const active = read.status === "ok" ? activeDeclarations(read.declarations, today) : [];
  return {
    constraints: active.map(toConstraint),
    active,
    status: read.status,
    ...(read.message ? { message: read.message } : {}),
  };
}

async function persist(declarations: TissueDeclaration[]): Promise<void> {
  snapshot = { declarations, status: "ok" };
  try {
    await AsyncStorage.setItem(KEY, encodeDeclarations(declarations));
  } catch {
    /* a failed write costs the declaration, never the ones already stored */
  }
}

/** Declare a constraint. Refuses to write over storage we could not parse —
 *  that would destroy the very entries the refusal is protecting. */
export async function declare(
  site: TissueSite,
  status: TissueStatus,
  provocation: TissueProvocation,
  note?: string,
  today = localToday()
): Promise<TissueRead> {
  const read = await readDeclarations();
  if (read.status === "unreadable") return readTissue(today);
  await persist(
    withDeclaration(read.declarations, {
      site,
      status,
      provocation,
      declaredOn: today,
      resolvedOn: null,
      ...(note?.trim() ? { note: note.trim().slice(0, 200) } : {}),
    })
  );
  return readTissue(today);
}

/** Mark a site healed — append-only, keeping the dated record. */
export async function resolve(site: TissueSite, today = localToday()): Promise<TissueRead> {
  const read = await readDeclarations();
  if (read.status !== "ok") return readTissue(today);
  await persist(withResolved(read.declarations, site, today));
  return readTissue(today);
}
