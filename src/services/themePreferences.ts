import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import { getAppSetting, setAppSetting, type RepositoryDatabase } from "@/db/repositories";
import type { ThemeMode } from "@/theme/colors";

function isThemeMode(value: string | undefined): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export async function loadThemePreference(db: RepositoryDatabase = openKitamoDatabase()): Promise<ThemeMode> {
  await runMigrations(db);
  const setting = await getAppSetting("themeMode", db);
  return isThemeMode(setting?.value) ? setting.value : "system";
}

export async function saveThemePreference(
  themeMode: ThemeMode,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<void> {
  await runMigrations(db);
  await setAppSetting("themeMode", themeMode, "string", db);
}
