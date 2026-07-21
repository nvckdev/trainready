import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/** Haptic beats for the moments that matter; silent no-ops on web. */

export function tapLight(): void {
  if (Platform.OS === "web") return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function tapSuccess(): void {
  if (Platform.OS === "web") return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
