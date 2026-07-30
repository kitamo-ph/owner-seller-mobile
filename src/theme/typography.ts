export const typography = {
  displayPeso: {
    fontSize: 42,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 48,
  },
  heroPeso: {
    fontSize: 34,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 40,
  },
  h1: {
    fontSize: 20,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 26,
  },
  h2: {
    fontSize: 16,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 22,
  },
  cardTitle: {
    fontSize: 14.5,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 20,
  },
  metricValue: {
    fontSize: 15,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 20,
  },
  body: {
    fontSize: 12.5,
    fontWeight: "600" as const,
    letterSpacing: 0,
    lineHeight: 18,
  },
  caption: {
    fontSize: 10.5,
    fontWeight: "600" as const,
    letterSpacing: 0,
    lineHeight: 14,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 14,
    textTransform: "uppercase" as const,
  },
  buttonLg: {
    fontSize: 16,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 21,
  },
  buttonSm: {
    fontSize: 12.5,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 17,
  },

  // Compatibility aliases let existing screens migrate one stage at a time.
  display: {
    fontSize: 28,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 34,
  },
  title: {
    fontSize: 20,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 26,
  },
  heading: {
    fontSize: 16,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 22,
  },
  label: {
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 14,
    textTransform: "uppercase" as const,
  },
  button: {
    fontSize: 12.5,
    fontWeight: "800" as const,
    letterSpacing: 0,
    lineHeight: 17,
  },
} as const;

export const moneyTypography = {
  fontVariant: ["tabular-nums"] as ("tabular-nums")[],
} as const;
