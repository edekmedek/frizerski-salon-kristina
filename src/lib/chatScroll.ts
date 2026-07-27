export function shouldScrollChat({
  conversationChanged,
  messageChanged,
  force,
  nearBottom,
}: {
  conversationChanged: boolean
  messageChanged: boolean
  force: boolean
  nearBottom: boolean
}) {
  return conversationChanged || force || (messageChanged && nearBottom)
}
