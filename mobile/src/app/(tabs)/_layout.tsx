import { Tabs } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { C, FONT, R } from "@/lib/theme";
import { tapLight } from "@/lib/haptics";

/** Floating pill tab bar — turn 2 (premium analytics pass): a rounded tray
 *  with the active tab as a signal-orange pill. Hairline border so it reads
 *  on both the field and sunken screen backgrounds. */

const LABELS: Record<string, string> = {
  index: "TODAY",
  plan: "PLAN",
  fitness: "FITNESS",
  goal: "GOAL",
};

function PillTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 14) }}>
      <View
        style={{
          backgroundColor: C.field,
          borderWidth: 1,
          borderColor: C.hairline,
          borderRadius: R.hero,
          padding: 8,
          flexDirection: "row",
        }}
      >
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const label = LABELS[route.name] ?? route.name.toUpperCase();
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => {
                const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !e.defaultPrevented) {
                  tapLight();
                  navigation.navigate(route.name);
                }
              }}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: R.pill,
                backgroundColor: focused ? C.signal : "transparent",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 10,
                  letterSpacing: 1.2,
                  color: focused ? C.field : C.boneFaint,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <PillTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.field },
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="plan" />
      <Tabs.Screen name="fitness" />
      <Tabs.Screen name="goal" />
    </Tabs>
  );
}
