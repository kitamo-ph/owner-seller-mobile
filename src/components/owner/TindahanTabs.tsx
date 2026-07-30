import { useRouter } from "expo-router";

import { GabiSegmentedControl } from "@/components/gabi/GabiControls";

export type TindahanTab = "paninda" | "grocery" | "recipes";

const options = [
  { label: "Paninda", value: "paninda" },
  { label: "Grocery", value: "grocery" },
  { label: "Recipes", value: "recipes" },
] as const;

export function TindahanTabs({ active }: { active: TindahanTab }) {
  const router = useRouter();

  function openTab(tab: TindahanTab) {
    if (tab === active) return;
    if (tab === "grocery") router.replace("/owner/grocery");
    else if (tab === "recipes") router.replace("/owner/recipes");
    else router.replace("/owner/inventory");
  }

  return <GabiSegmentedControl onChange={openTab} options={options} selected={active} />;
}
