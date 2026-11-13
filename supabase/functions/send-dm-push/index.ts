import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Content-Type": "application/json",
};

function getNotificationBody(text: string): string {
  const storyPrefix = "socialapp-story:";
  if (text.startsWith(storyPrefix)) {
    try {
      const story = JSON.parse(text.slice(storyPrefix.length));
      return story.comment
        ? `Story: ${String(story.comment).slice(0, 140)}`
        : "Shared a story";
    } catch {
      return "Shared a story";
    }
  }

  const mediaPrefix = "socialapp-media:";
  if (text.startsWith(mediaPrefix)) {
    try {
      const media = JSON.parse(text.slice(mediaPrefix.length));
      if (media.type === "video") return "Sent a video";
      if (media.type === "image") return "Sent a photo";
    } catch {
      return "Sent an attachment";
    }
    return "Sent an attachment";
  }

  return String(text).slice(0, 150);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookSecret = Deno.env.get("WEBHOOK_SECRET");

  if (
    !webhookSecret ||
    req.headers.get("x-webhook-secret") !== webhookSecret
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const payload = await req.json();
    const message = payload.record;

    if (
      !message?.id ||
      !message?.sender_id ||
      !message?.receiver_id ||
      !message?.text
    ) {
      return new Response(
        JSON.stringify({ error: "Invalid message record" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check whether receiver is actively inside this exact conversation.
    const { data: presence, error: presenceError } = await supabase
      .from("user_presence")
      .select("is_online, last_seen_at, active_conversation_id")
      .eq("user_id", message.receiver_id)
      .maybeSingle();

    if (presenceError) {
      console.error("Presence check failed:", presenceError);
    }

    const lastSeen = presence?.last_seen_at
      ? new Date(presence.last_seen_at).getTime()
      : 0;

    const presenceIsFresh =
      lastSeen > 0 && Date.now() - lastSeen < 60000;

    const receiverInSameChat =
      presence?.is_online === true &&
      presenceIsFresh &&
      presence?.active_conversation_id === message.conversation_id;

    if (receiverInSameChat) {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: "Receiver is active in this conversation",
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Otherwise, send push notification to receiver's registered devices.
    const { data: tokens, error: tokenError } = await supabase
      .from("user_push_tokens")
      .select("expo_push_token")
      .eq("user_id", message.receiver_id);

    if (tokenError) throw tokenError;

    if (!tokens?.length) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No registered devices",
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    const { data: sender } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", message.sender_id)
      .maybeSingle();

    const senderName =
      sender?.full_name || sender?.username || "Someone";

    const body = getNotificationBody(String(message.text));

    const notifications = tokens.map((item) => ({
      to: item.expo_push_token,
      sound: "default",
      title: `New message from ${senderName}`,
      body,
      priority: "high",
      channelId: "default",
      data: {
        type: "direct_message",
        conversationId: message.conversation_id,
        messageId: message.id,
        senderId: message.sender_id,
      },
    }));

    const pushResponse = await fetch(
      "https://exp.host/--/api/v2/push/send",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(notifications),
      }
    );

    const result = await pushResponse.json();

    if (!pushResponse.ok) {
      throw new Error(JSON.stringify(result));
    }

    return new Response(
      JSON.stringify({ success: true, result }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error("DM push error:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Push failed",
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
