import { Platform } from "react-native";

export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: "#1C1830",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 10,
    },
    default: { elevation: 2 },
  }),
  raised: Platform.select({
    ios: {
      shadowColor: "#1C1830",
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.2,
      shadowRadius: 30,
    },
    default: { elevation: 10 },
  }),
  primaryGlow: Platform.select({
    ios: {
      shadowColor: "#4F2EC9",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.35,
      shadowRadius: 22,
    },
    default: { elevation: 7 },
  }),
  sheet: Platform.select({
    ios: {
      shadowColor: "#1C1830",
      shadowOffset: { width: 0, height: -18 },
      shadowOpacity: 0.35,
      shadowRadius: 50,
    },
    default: { elevation: 14 },
  }),
  darkCard: Platform.select({ ios: { shadowOpacity: 0 }, default: { elevation: 0 } }),
  hero: Platform.select({
    ios: {
      shadowColor: "#1C1830",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.2,
      shadowRadius: 22,
    },
    default: { elevation: 6 },
  }),
} as const;
