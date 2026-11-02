/**
 * Native modules that must not be load-bearing.
 *
 * A dev build contains exactly the native modules that existed when it was
 * made, so adding one leaves every installed build unable to import it — the
 * JS crashes on require and the whole app is unusable until a new binary is
 * installed. That is a bad trade for two conveniences.
 *
 * Haptics and notifications are both conveniences: the rest timer's source of
 * truth is a timestamp in SQLite and its display is the in-app bar. When these
 * are missing the timer still runs correctly, it just does not buzz.
 *
 * Resolved at call time rather than at import so a module that appears in a
 * later build is picked up without changing this file.
 */

interface HapticsModule {
  notificationAsync(type: unknown): Promise<void>;
  NotificationFeedbackType: { Success: unknown; Warning: unknown; Error: unknown };
}

export interface LiveActivityState {
  title: string;
  subtitle?: string;
  /** `date` is an end timestamp in MILLISECONDS — the module counts down to it. */
  progressBar: { date?: number; progress?: number };
}

export interface LiveActivityConfig {
  backgroundColor?: string;
  titleColor?: string;
  subtitleColor?: string;
  progressViewTint?: string;
  timerType?: 'circular' | 'digital';
}

interface LiveActivityModule {
  startActivity(state: LiveActivityState, config?: LiveActivityConfig): string | undefined;
  updateActivity(id: string, state: LiveActivityState): void;
  stopActivity(id: string, state: LiveActivityState): void;
}

interface NotificationsModule {
  getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  scheduleNotificationAsync(request: unknown): Promise<string>;
  cancelScheduledNotificationAsync(id: string): Promise<void>;
  setNotificationHandler(handler: {
    handleNotification: () => Promise<{
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
      shouldShowBanner: boolean;
      shouldShowList: boolean;
    }>;
  } | null): void;
  SchedulableTriggerInputTypes: { TIME_INTERVAL: string };
}

/**
 * The paths are literals because Metro resolves `require` statically — a
 * variable path fails the bundle outright ("Invalid call at line …"), so each
 * module needs its own call site.
 */
export function haptics(): HapticsModule | null {
  try {
    return require('expo-haptics') as HapticsModule;
  } catch {
    return null;
  }
}

export function liveActivity(): LiveActivityModule | null {
  try {
    return require('expo-live-activity') as LiveActivityModule;
  } catch {
    return null;
  }
}

interface DocumentPickerModule {
  getDocumentAsync(options: {
    type?: string | string[];
    copyToCacheDirectory?: boolean;
  }): Promise<{
    canceled: boolean;
    assets?: { uri: string; name: string; size?: number }[];
  }>;
}

interface FileSystemModule {
  readText(uri: string): Promise<string>;
}

interface FileClassModule {
  File?: new (uri: string) => { text(): Promise<string> };
}

interface LegacyFileSystemModule {
  readAsStringAsync(uri: string, options?: { encoding?: string }): Promise<string>;
}

interface HealthKitModule {
  isHealthDataAvailable(): boolean;
  requestAuthorization(types: { toShare: readonly string[]; toRead: readonly string[] }): Promise<boolean>;
  /**
   * `activityType` is a NUMERIC enum, not the Swift identifier string —
   * `traditionalStrengthTraining` is 50. Passing the string silently wrote
   * nothing.
   */
  saveWorkoutSample(
    activityType: number,
    quantities: readonly unknown[],
    start: Date,
    end: Date,
    totals?: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<unknown>;
  /**
   * HealthKit only permits deleting samples the calling app wrote itself, so
   * this can never touch a workout from another app or a watch.
   */
  deleteObjects?(
    typeIdentifier: string,
    filter: { date?: { from?: Date; to?: Date } },
  ): Promise<number>;
  WorkoutActivityType?: Record<string, number>;
}

interface SharingModule {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(url: string, options?: { mimeType?: string; dialogTitle?: string; UTI?: string }): Promise<void>;
}

interface FileWriterModule {
  writeText(uri: string, text: string): Promise<void>;
  cacheDirectory(): string | null;
}

interface CryptoModule {
  digestStringAsync(algorithm: string, data: string): Promise<string>;
  CryptoDigestAlgorithm: { SHA256: string };
}

/**
 * The file pickers. Import is the whole wedge, so unlike haptics these are not
 * optional in spirit — but they are still loaded this way so that a build
 * predating them shows "Import needs the latest version" rather than a white
 * screen on launch.
 */
export function documentPicker(): DocumentPickerModule | null {
  try {
    return require('expo-document-picker') as DocumentPickerModule;
  } catch {
    return null;
  }
}

/**
 * Reading a picked file, across two generations of the Expo filesystem API.
 *
 * SDK 54 deprecated `readAsStringAsync` and made it **throw at runtime** rather
 * than warn, which is how it surfaced: the importer failed on a real device
 * with a paragraph about migrating to `File` and `Directory`. The new API is
 * preferred here and the legacy entry point is the fallback, so a build made
 * against either generation works.
 */
export function fileSystem(): FileSystemModule | null {
  try {
    const modern = require('expo-file-system') as FileClassModule;
    if (typeof modern.File === 'function') {
      const FileClass = modern.File;
      return { readText: async (uri: string) => new FileClass(uri).text() };
    }
  } catch {
    // fall through to the legacy entry point
  }

  try {
    const legacy = require('expo-file-system/legacy') as LegacyFileSystemModule;
    return { readText: (uri: string) => legacy.readAsStringAsync(uri) };
  } catch {
    return null;
  }
}

export function healthKit(): HealthKitModule | null {
  try {
    return require('@kingstinct/react-native-healthkit') as HealthKitModule;
  } catch {
    return null;
  }
}

interface StoreReviewModule {
  isAvailableAsync(): Promise<boolean>;
  requestReview(): Promise<void>;
}

export function storeReview(): StoreReviewModule | null {
  try {
    return require('expo-store-review') as StoreReviewModule;
  } catch {
    return null;
  }
}

export function sharing(): SharingModule | null {
  try {
    return require('expo-sharing') as SharingModule;
  } catch {
    return null;
  }
}

/**
 * Writing a file out, across the same two filesystem generations as reading.
 * `File` in the current API writes with `.write()`; the legacy entry point uses
 * `writeAsStringAsync`.
 */
export function fileWriter(): FileWriterModule | null {
  try {
    const modern = require('expo-file-system') as {
      File?: new (...parts: unknown[]) => { create(options?: unknown): void; write(text: string): void; uri: string };
      Paths?: { cache?: { uri?: string } };
    };
    if (typeof modern.File === 'function') {
      const FileClass = modern.File;
      return {
        writeText: async (uri: string, text: string) => {
          const file = new FileClass(uri);
          try { file.create({ overwrite: true }); } catch { /* already there */ }
          file.write(text);
        },
        cacheDirectory: () => modern.Paths?.cache?.uri ?? null,
      };
    }
  } catch {
    // fall through
  }

  try {
    const legacy = require('expo-file-system/legacy') as {
      writeAsStringAsync(uri: string, contents: string): Promise<void>;
      cacheDirectory: string | null;
    };
    return {
      writeText: (uri: string, text: string) => legacy.writeAsStringAsync(uri, text),
      cacheDirectory: () => legacy.cacheDirectory,
    };
  } catch {
    return null;
  }
}

export function cryptoModule(): CryptoModule | null {
  try {
    return require('expo-crypto') as CryptoModule;
  } catch {
    return null;
  }
}

export function notifications(): NotificationsModule | null {
  try {
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}
