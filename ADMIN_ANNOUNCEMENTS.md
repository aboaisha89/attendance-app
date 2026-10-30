# Employee announcements

Admin → Announcements. Choose everyone or specific active employees, enter a title/message, and send. Every recipient gets an inbox notification and a mandatory acknowledgement modal on opening or while using the app (polled every 3 seconds when the tab is visible). The administrator sees aggregate acknowledgements.

Neon tables `admin_messages` and `admin_message_recipients` are created by the additive schema initializer. Run the existing Neon setup once if the instance was not initialized, or deploy and sign in through existing bootstrap. Requires working `DATABASE_URL`. No changes to Supabase image storage.

The updates are near-real-time via 3-second polling, not WebSocket push. A browser suspended in the background displays the message when the app becomes active again. Delivery/read acknowledgement is verified server-side; notifications alone do not count as acknowledgement.
