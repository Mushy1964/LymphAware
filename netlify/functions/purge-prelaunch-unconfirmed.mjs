import { db } from './_shared/prelaunch-interest.mjs';
// An unconfirmed address has not opted in: minimise retention automatically.
// Confirmation links expire after 48 hours; unconfirmed entries are removed after seven days.
export default async () => {
  try {
    const threshold=new Date(Date.now()-7*24*60*60*1000).toISOString();
    await db('prelaunch_interest',
      'confirmed_at=is.null&created_at=lt.'+encodeURIComponent(threshold),
      {method:'DELETE',headers:{Prefer:'return=minimal'}});
    return new Response('Old unconfirmed registrations removed.',{status:200});
  }catch(error){
    console.error('Prelaunch interest cleanup failed',error?.message);
    return new Response('Cleanup unavailable.',{status:500});
  }
};
export const config={schedule:'0 2 * * *'};
