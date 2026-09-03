import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getApiKey = () => {
  return process.env.api_key || process.env.GEMINI_API_KEY || process.env.API_KEY || '';
};

function extractOutputText(data: any): string {
  if (data?.output_text) return data.output_text;
  if (Array.isArray(data?.steps)) {
    const textParts: string[] = [];
    for (const step of data.steps) {
      if (step.type === 'model_output' && Array.isArray(step.content)) {
        for (const item of step.content) {
          if (item.text) {
            textParts.push(item.text);
          }
        }
      }
    }
    if (textParts.length > 0) return textParts.join('\n');
  }
  return 'No response generated.';
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Configuration Error', details: 'Gemini API key is not configured. Please set api_key or GEMINI_API_KEY in your .env file.' },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { message, history = [], model = 'gemini-3.5-flash-lite', attachments = [], previous_interaction_id } = body;

    let inputContent: any = message;

    if (attachments && attachments.length > 0) {
      inputContent = [];
      if (message) {
        inputContent.push({ type: 'text', text: message });
      }
      for (const att of attachments) {
        if (att.type.startsWith('image/')) {
          inputContent.push({
            type: 'image',
            data: att.data,
            mime_type: att.type
          });
        } else {
          inputContent.push({
            type: 'document',
            data: att.data,
            mime_type: att.type
          });
        }
      }
    }

    // Helper to build multi-turn steps from history
    const buildHistorySteps = () => {
      const steps: any[] = [];
      for (const item of history) {
        if (!item.content) continue;
        if (item.role === 'user') {
          steps.push({
            type: 'user_input',
            content: [{ type: 'text', text: item.content }]
          });
        } else if (item.role === 'ai') {
          steps.push({
            type: 'model_output',
            content: [{ type: 'text', text: item.content }]
          });
        }
      }
      // Add current turn input
      if (Array.isArray(inputContent)) {
        steps.push({
          type: 'user_input',
          content: inputContent
        });
      } else {
        steps.push({
          type: 'user_input',
          content: [{ type: 'text', text: inputContent || '' }]
        });
      }
      return steps;
    };

    const callApi = async (selectedModel: string) => {
      const reqPayload: any = {
        model: selectedModel,
      };

      if (previous_interaction_id) {
        reqPayload.previous_interaction_id = previous_interaction_id;
        reqPayload.input = inputContent;
      } else if (history && history.length > 0) {
        reqPayload.input = buildHistorySteps();
      } else {
        reqPayload.input = inputContent;
      }

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqPayload)
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const error = new Error(data.error?.message || `API request failed with status ${res.status}`);
        (error as any).status = res.status;
        (error as any).code = data.error?.code;
        throw error;
      }

      return data;
    };

    let resultData: any;
    let note = '';

    try {
      resultData = await callApi(model);
    } catch (err: any) {
      // If previous_interaction_id failed (session expired or invalid), retry fresh with history
      if (previous_interaction_id) {
        console.warn('Continuing interaction failed, retrying with fresh history');
        const fallbackPayload: any = {
          model: model,
          input: buildHistorySteps()
        };
        const retryRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fallbackPayload)
        });
        const retryData = await retryRes.json();
        if (retryRes.ok && !retryData.error) {
          resultData = retryData;
        } else {
          // If rate limited on gemini-3.6-flash, fallback to gemini-3.5-flash-lite
          if ((retryData.error?.code === 'too_many_requests' || retryRes.status === 429) && model === 'gemini-3.6-flash') {
            console.warn('Quota limit on gemini-3.6-flash, falling back to gemini-3.5-flash-lite');
            resultData = await callApi('gemini-3.5-flash-lite');
            note = '> ℹ️ *Gemini 3.6 Flash free tier rate limit reached — served with Gemini 3.5 Flash-Lite.*\n\n';
          } else {
            throw new Error(retryData.error?.message || 'API request failed');
          }
        }
      } else if ((err.status === 429 || err.code === 'too_many_requests' || err.message?.includes('Quota exceeded')) && model === 'gemini-3.6-flash') {
        // Fallback from gemini-3.6-flash to gemini-3.5-flash-lite
        console.warn('Quota limit on gemini-3.6-flash, falling back to gemini-3.5-flash-lite');
        resultData = await callApi('gemini-3.5-flash-lite');
        note = '> ℹ️ *Gemini 3.6 Flash free tier rate limit reached — served with Gemini 3.5 Flash-Lite.*\n\n';
      } else {
        throw err;
      }
    }

    const responseText = note + extractOutputText(resultData);

    return NextResponse.json({
      response: responseText,
      interaction_id: resultData.id,
    });
  } catch (error: any) {
    console.error('Error calling Gemini API:', error);
    
    let userFriendlyMessage = error.message || 'Unknown error occurred';
    if (userFriendlyMessage.includes('Quota exceeded') || error.status === 429) {
      userFriendlyMessage = 'Quota limit reached for this model on free tier. Please select Gemini 3.5 Flash-Lite or Gemini 3.1 Flash-Lite from the model selector.';
    }

    return NextResponse.json(
      { error: 'Failed to communicate with Gemini API', details: userFriendlyMessage },
      { status: 500 }
    );
  }
}
