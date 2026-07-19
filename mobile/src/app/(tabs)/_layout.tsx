import { Tabs } from "expo-router";
import { Text } from "react-native";
import { C, FONT } from "@/lib/theme";

/** Bottom tab bar in the Night Instrument voice: mono labels, signal marks the
 *  active tab (orange marks what's live), hairline top rule. */

function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text
      style={{
        fontFamily: FONT.mono,
        fontSize: 10,
        letterSpacing: 1.1,
        textTransform: "uppercase",
        color: focused ? C.signalText : C.boneMuted,
      }}
    >
      {label}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.field,
          borderTopColor: C.hairline,
          borderTopWidth: 1,
        },
        tabBarShowLabel: true,
        tabBarIconStyle: { display: "none" },
        sceneStyle: { backgroundColor: C.field },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ tabBarLabel: ({ focused }) => <TabLabel label="Today" focused={focused} /> }}
      />
      <Tabs.Screen
        name="plan"
        options={{ tabBarLabel: ({ focused }) => <TabLabel label="Plan" focused={focused} /> }}
      />
      <Tabs.Screen
        name="fitness"
        options={{ tabBarLabel: ({ focused }) => <TabLabel label="Fitness" focused={focused} /> }}
      />
      <Tabs.Screen
        name="goal"
        options={{ tabBarLabel: ({ focused }) => <TabLabel label="Goal" focused={focused} /> }}
      />
    </Tabs>
  );
}
