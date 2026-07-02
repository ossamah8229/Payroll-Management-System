/** Local-time-of-day greeting — never fetched from the network, always the browser's own clock. */
export function getTimeOfDayGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export function Greeting({ name }: { name: string }) {
  return (
    <>
      {getTimeOfDayGreeting()}, {name}!
    </>
  );
}
