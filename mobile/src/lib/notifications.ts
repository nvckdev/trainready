import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import type { StoredPlan } from "./store";
import { localToday } from "./store";

/**
 * Session reminders — local notifications only, scheduled on this device
 * from the stored plan. Nothing registers with a push service; clearing the
 * plan or the toggle cancels everything. iOS caps pending notifications at
 * 64, so we schedule the next 30 sessions and resync when the plan changes.
 */

const PREF_KEY = "taper.reminders.v1";
const REMINDER_HOUR = 7;
const MAX_SCHEDULED = 30;

export const remindersSupported = Platform.OS !== "web";

export async function readRemindersEnabled(): Promise<boolean> {
  if (!remindersSupported) return false;
  return (await AsyncStorage.getItem(PREF_KEY)) === "on";
}

async function ensurePermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

async function scheduleFor(plan: StoredPlan): Promise<number> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("sessions", {
      name: "Session reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const today = localToday();
  const now = Date.now();
  const upcoming = plan.plan.weeks
    .flatMap((w) => w.sessions)
    .filter((s) => s.date >= today)
    .slice(0, MAX_SCHEDULED);
  let scheduled = 0;
  for (const s of upcoming) {
    const [y, m, d] = s.date.split("-").map(Number);
    const fire = new Date(y, m - 1, d, REMINDER_HOUR, 0, 0);
    if (fire.getTime() <= now) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: s.title,
        body: `${Math.round(s.durationHr * 60)} min · ${s.tss} TSS. ${s.why}`,
        sound: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fire,
        channelId: Platform.OS === "android" ? "sessions" : undefined,
      },
    });
    scheduled++;
  }
  return scheduled;
}

/** Flip the preference. Returns false if permission was denied. */
export async function setRemindersEnabled(on: boolean, plan: StoredPlan | null): Promise<boolean> {
  if (!remindersSupported) return false;
  if (!on) {
    await AsyncStorage.setItem(PREF_KEY, "off");
    await Notifications.cancelAllScheduledNotificationsAsync();
    return true;
  }
  if (!(await ensurePermission())) return false;
  await AsyncStorage.setItem(PREF_KEY, "on");
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (plan) await scheduleFor(plan);
  return true;
}

/** Re-derive the schedule from the current plan (call after plan changes). */
export async function syncReminders(plan: StoredPlan | null): Promise<void> {
  if (!remindersSupported) return;
  if (!(await readRemindersEnabled())) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (plan) await scheduleFor(plan);
}
