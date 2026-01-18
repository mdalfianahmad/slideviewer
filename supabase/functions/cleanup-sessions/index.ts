// Supabase Edge Function: cleanup-sessions
// This function ends sessions that have been active for more than 24 hours
// Deploy with: supabase functions deploy cleanup-sessions

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Create Supabase client with service role for admin access
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Calculate 24 hours ago
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

        // Update old active sessions to ended
        const { data, error, count } = await supabase
            .from('sessions')
            .update({
                status: 'ended',
                ended_at: new Date().toISOString(),
            })
            .eq('status', 'active')
            .lt('started_at', twentyFourHoursAgo.toISOString())
            .select();

        if (error) {
            throw error;
        }

        console.log(`Cleaned up ${data?.length || 0} old sessions`);

        return new Response(
            JSON.stringify({
                success: true,
                message: `Ended ${data?.length || 0} old sessions`,
                sessions: data,
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        );
    } catch (error) {
        console.error('Cleanup error:', error);

        return new Response(
            JSON.stringify({
                success: false,
                error: error.message,
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            }
        );
    }
});

// To schedule this function to run hourly:
// 1. Deploy: supabase functions deploy cleanup-sessions
// 2. Set up a cron job (e.g., using cron-job.org) to call the function endpoint
// 3. Or use Supabase's pg_cron extension (requires Pro plan)
