import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history = [], model = 'gemini-3.6-flash', attachments = [] } = body;

    let inputContent: any = message;

    if (attachments.length > 0) {
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

    let interaction;

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

    if (body.previous_interaction_id) {
      try {
        // Try continuing existing interaction session
        interaction = await ai.interactions.create({
          model: model,
          input: inputContent,
          previous_interaction_id: body.previous_interaction_id,
        });
      } catch (err: any) {
        console.warn('Continuing interaction failed (e.g. cross-model switch or expired session). Falling back to history steps:', err.message);
        // Fallback: If continuing failed, start a fresh interaction with conversation history
        const fallbackSteps = buildHistorySteps();
        interaction = await ai.interactions.create({
          model: model,
          input: fallbackSteps,
        });
      }
    } else if (history && history.length > 0) {
      // No previous interaction ID, but history exists (e.g. fresh session or reconstructed)
      const steps = buildHistorySteps();
      interaction = await ai.interactions.create({
        model: model,
        input: steps,
      });
    } else {
      // First turn of a conversation
      interaction = await ai.interactions.create({
        model: model,
        input: inputContent,
      });
    }

    return NextResponse.json({
      response: interaction.output_text,
      interaction_id: interaction.id,
    });
  } catch (error: any) {
    console.error('Error calling Gemini API:', error);
    
    let userFriendlyMessage = error.message || 'Unknown error occurred';
    if (userFriendlyMessage.includes('Quota exceeded') || error.status === 429) {
      userFriendlyMessage = 'Quota limit exceeded for this model. Please select a Flash model (e.g. Gemini 3.6 Flash) or wait before trying again.';
    }

    return NextResponse.json(
      { error: 'Failed to communicate with Gemini API', details: userFriendlyMessage },
      { status: 500 }
    );
  }
}

