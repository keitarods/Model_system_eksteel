// Legacy endpoint retained for older clients. Account existence is deliberately
// not disclosed. Login validates credentials directly through Supabase Auth and
// does not require an administrative key or a scan of all users.
export async function POST() {
  return Response.json({ exists: null }, { headers: { 'Cache-Control': 'no-store' } });
}
