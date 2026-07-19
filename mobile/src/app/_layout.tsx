import { useEffect } from "react";
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_800ExtraBold,
} from "@expo-google-fonts/archivo";
import { FragmentMono_400Regular } from "@expo-google-fonts/fragment-mono";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { C } from "@/lib/theme";

// Hold the native splash until the faces are in — no blank frame, no font
// swap flash. A font-load *failure* still releases it: the platform
// fallbacks are ugly but an app that opens beats one that hangs.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_800ExtraBold,
    FragmentMono_400Regular,
  });

  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <View style={{ flex: 1, backgroundColor: C.field }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.field } }} />
    </View>
  );
}
