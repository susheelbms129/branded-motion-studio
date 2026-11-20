import { createServerFn } from "@tanstack/react-start";

/**
 * Is WhatsApp switched on for this deployment? True only when the sending token and number are set on the server.
 * Until then the settings panel says "coming soon" instead of asking people for a number that nothing could message.
 * Returns only a yes/no: the token never leaves the server.
 */
export const whatsappLive = createServerFn({ method: "GET" }).handler(async (): Promise<{ live: boolean }> => {
  return { live: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_CRON_SECRET) };
});
