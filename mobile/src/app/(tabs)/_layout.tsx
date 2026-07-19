import { Tabs } from "expo-router";
import { Text, View } from "react-native";
import { C, FONT } from "@/lib/theme";

/** Bottom tab bar — redesign pass 1a: sunken bed, hairline top rule, a 5px
 *  signal dot above the active mono label. Orange marks where you are. */

function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={{ alignItems: "center", gap: 5, paddingTop: 6 }}>
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: focused ? C.signal : "transparent",
        }}
      />
      <Text
        style={{
          fontFamily: FONT.mono,
          fontSize: 11,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: focused ? C.signalText : C.boneFaint,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.fieldSunken,
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
