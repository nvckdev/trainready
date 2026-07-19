import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_800ExtraBold,
} from "@expo-google-fonts/archivo";
import { FragmentMono_400Regular } from "@expo-google-fonts/fragment-mono";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { C } from "@/lib/theme";

export default function RootLayout() {
  const [loaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_800ExtraBold,
    FragmentMono_400Regular,
  });
  // Hold the splash color until faces are in — nothing flashes unstyled.
  if (!loaded) return <View style={{ flex: 1, backgroundColor: C.field }} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.field }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.field } }} />
    </View>
  );
}
