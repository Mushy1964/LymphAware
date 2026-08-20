import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async (request) => {

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: 'Method not allowed'
      }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }

  try {

    const authHeader =
      request.headers.get('authorization');

    if (
      !authHeader ||
      !authHeader.startsWith('Bearer ')
    ) {
      return new Response(
        JSON.stringify({
          error: 'Authentication required.'
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const accessToken =
      authHeader.replace('Bearer ', '').trim();


    const userResponse = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            process.env.SUPABASE_PUBLISHABLE_KEY,

          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );


    if (!userResponse.ok) {
      return new Response(
        JSON.stringify({
          error: 'Unable to verify your LymphAware account.'
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const user =
      await userResponse.json();


    if (!user?.id) {
      return new Response(
        JSON.stringify({
          error: 'Unable to verify your LymphAware account.'
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const membershipResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${user.id}&select=membership_status,payment_status,initial_fee_pence`,
      {
        headers: {
          apikey:
            process.env.SUPABASE_PUBLISHABLE_KEY,

          Authorization:
            `Bearer ${accessToken}`,

          Accept:
            'application/json'
        }
      }
    );


    if (!membershipResponse.ok) {
      return new Response(
        JSON.stringify({
          error: 'Unable to verify your membership.'
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const memberships =
      await membershipResponse.json();

    const membership =
      memberships?.[0];


    if (
      !membership ||
      membership.membership_status !== 'ACTIVE' ||
      membership.payment_status !== 'PENDING'
    ) {
      return new Response(
        JSON.stringify({
          error: 'No membership payment is currently due.'
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    if (
      Number(membership.initial_fee_pence) !== 2000
    ) {
      return new Response(
        JSON.stringify({
          error: 'Membership fee could not be verified.'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const checkoutSession =
      await stripe.checkout.sessions.create({

        mode: 'payment',

        line_items: [
          {
            price:
              process.env.STRIPE_MEMBERSHIP_PRICE_ID,

            quantity: 1
          }
        ],

        customer_email:
          user.email || undefined,

        client_reference_id:
          user.id,

        metadata: {
          lymphaware_user_id:
            user.id,

          payment_type:
            'initial_membership'
        },

        success_url:
          'https://lymphaware.com/portal/?payment=success',

        cancel_url:
          'https://lymphaware.com/portal/?payment=cancelled'
      });


    return new Response(
      JSON.stringify({
        url: checkoutSession.url
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

  } catch (error) {

    console.error(
      'Unable to create Stripe Checkout session:',
      error
    );

    return new Response(
      JSON.stringify({
        error: 'Unable to start membership payment.'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
};
