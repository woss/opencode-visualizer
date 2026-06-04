interface NotifyBackendOptions {
  preferCmux: boolean;
  tryCmuxNotify: () => Promise<boolean>;
  sendDesktopNotification: () => void | Promise<void>;
}

export interface DesktopNotificationOptions {
  title: string;
  message: string;
  subtitle?: string;
  sound?: string;
  senderBundleId?: string | null;
}

interface DesktopNotificationRouterOptions extends DesktopNotificationOptions {
  sendNodeNotifierNotification: () => void;
  sendMacOSNotification?: (
    options: DesktopNotificationOptions,
  ) => Promise<boolean>;
}

export async function sendDesktopNotificationByPlatform(
  options: DesktopNotificationRouterOptions,
): Promise<void> {
  const {
    sendNodeNotifierNotification,
    sendMacOSNotification,
    ...notificationOptions
  } = options;

  if (sendMacOSNotification) {
    await sendMacOSNotification(notificationOptions);
    return;
  }

  sendNodeNotifierNotification();
}

export async function sendNotificationWithFallback(
  options: NotifyBackendOptions,
): Promise<void> {
  if (!options.preferCmux) {
    await options.sendDesktopNotification();
    return;
  }

  try {
    const sentViaCmux = await options.tryCmuxNotify();
    if (sentViaCmux) return;
  } catch {
    // Fall through to desktop notification fallback
  }

  await options.sendDesktopNotification();
}
