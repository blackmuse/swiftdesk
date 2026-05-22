const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const USERS_FILE = process.env.VERCEL
  ? '/tmp/users.json'
  : path.join(__dirname, '../data/users.json');

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function incrementUsage(userId) {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const idx = users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      users[idx].usageCount = (users[idx].usageCount || 0) + 1;
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    }
  } catch {}
}

async function streamResponse(res, model, systemPrompt, userMessage) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const anthropic = getAnthropicClient();
  const stream = anthropic.messages.stream({
    model,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

// POST /api/tools/denial-appeal
router.post('/denial-appeal', authenticateToken, async (req, res) => {
  try {
    const { patientName, dob, memberId, insurancePlan, serviceDate, cptCodes, diagnosisCodes, denialReason, providerName, npi } = req.body;

    if (!patientName || !denialReason) {
      return res.status(400).json({ error: 'Patient name and denial reason are required' });
    }

    incrementUsage(req.user.id);

    const systemPrompt = `You are an expert medical billing appeals specialist with 20 years of experience writing successful insurance denial appeals. You write professional, persuasive, and medically accurate appeal letters that reference appropriate clinical guidelines, medical necessity criteria, and payer-specific policies. Your letters are formal, well-structured, and include all necessary supporting arguments to overturn denials.`;

    const userMessage = `Write a professional insurance denial appeal letter with the following details:

Patient Name: ${patientName}
Date of Birth: ${dob || 'Not provided'}
Member ID: ${memberId || 'Not provided'}
Insurance Plan: ${insurancePlan || 'Not provided'}
Service Date: ${serviceDate || 'Not provided'}
CPT Code(s): ${cptCodes || 'Not provided'}
Diagnosis Code(s): ${diagnosisCodes || 'Not provided'}
Denial Reason: ${denialReason}
Provider Name: ${providerName || 'Not provided'}
NPI: ${npi || 'Not provided'}

Write a complete, professional appeal letter that:
1. States the purpose clearly in the opening
2. Provides clinical justification for medical necessity
3. References relevant clinical guidelines or payer policies
4. Addresses the specific denial reason directly
5. Includes a clear request for reconsideration
6. Maintains a professional, formal tone throughout

Format the letter properly with date, addresses, salutation, body paragraphs, and closing.`;

    await streamResponse(res, 'claude-sonnet-4-6', systemPrompt, userMessage);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate appeal letter' });
    }
  }
});

// POST /api/tools/cpt-suggester
router.post('/cpt-suggester', authenticateToken, async (req, res) => {
  try {
    const { clinicalNotes, specialty, visitType, additionalContext } = req.body;

    if (!clinicalNotes) {
      return res.status(400).json({ error: 'Clinical notes are required' });
    }

    incrementUsage(req.user.id);

    const systemPrompt = `You are a Certified Professional Coder (CPC) with deep expertise in medical coding across all specialties. You are highly knowledgeable about CPT codes, ICD-10-CM diagnosis codes, modifiers, and medical coding guidelines (AMA, CMS, and specialty-specific). You provide accurate, compliant code suggestions with clear justifications based on documentation.`;

    const userMessage = `Analyze the following clinical documentation and suggest appropriate medical codes:

Clinical Notes:
${clinicalNotes}

Specialty: ${specialty || 'General'}
Visit Type: ${visitType || 'Not specified'}
Additional Context: ${additionalContext || 'None'}

Please provide:

## CPT Code Suggestions
For each suggested CPT code:
- Code number
- Full description
- Why this code applies based on the documentation
- Any relevant notes or caveats

## ICD-10-CM Diagnosis Codes
For each suggested diagnosis code:
- Code
- Description
- Supporting documentation evidence

## Recommended Modifiers
- List any applicable modifiers with explanations

## Coding Notes & Compliance Tips
- Any documentation gaps that should be addressed
- Bundling considerations
- Medical necessity documentation recommendations

Be specific and cite the documentation evidence for each recommendation.`;

    await streamResponse(res, 'claude-sonnet-4-6', systemPrompt, userMessage);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate code suggestions' });
    }
  }
});

// POST /api/tools/ar-followup
router.post('/ar-followup', authenticateToken, async (req, res) => {
  try {
    const { patientName, accountNumber, balance, insurancePlan, serviceDate, claimNumber, daysPending, previousActions, contactName } = req.body;

    if (!patientName || !balance) {
      return res.status(400).json({ error: 'Patient name and balance are required' });
    }

    incrementUsage(req.user.id);

    const systemPrompt = `You are an experienced Accounts Receivable (AR) specialist in medical billing with expertise in insurance follow-up, claim appeals, and patient collections. You create effective, professional follow-up scripts and correspondence that are compliant with healthcare billing regulations and designed to maximize collection rates while maintaining positive relationships with payers and patients.`;

    const userMessage = `Generate comprehensive AR follow-up materials for the following account:

Patient Name: ${patientName}
Account Number: ${accountNumber || 'Not provided'}
Outstanding Balance: $${balance}
Insurance Plan: ${insurancePlan || 'Not provided'}
Service Date: ${serviceDate || 'Not provided'}
Claim Number: ${claimNumber || 'Not provided'}
Days Pending: ${daysPending || 'Not specified'}
Previous Actions Taken: ${previousActions || 'None documented'}
Insurance Contact Name: ${contactName || 'Not provided'}

Please generate all of the following:

## Phone Call Script
A complete script for calling the insurance company, including:
- Opening and verification statements
- Specific questions to ask about claim status
- How to respond to common objections or delays
- Escalation language if needed
- Closing and follow-up commitment

## Follow-up Email Template
A professional email to send to the insurance company or patient

## Escalation Path
Step-by-step escalation strategy if initial follow-up doesn't resolve the issue

## Documentation Checklist
What to document after each follow-up attempt

Format each section clearly with headers.`;

    await streamResponse(res, 'claude-sonnet-4-6', systemPrompt, userMessage);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate AR follow-up materials' });
    }
  }
});

// POST /api/tools/monthly-report
router.post('/monthly-report', authenticateToken, async (req, res) => {
  try {
    const { month, year, totalRevenue, totalClaims, denialRate, collectionRate, topDenialReasons, topPayers, outstandingAR, avgDaysInAR, previousMonthRevenue, specialty } = req.body;

    if (!month || !year || !totalRevenue) {
      return res.status(400).json({ error: 'Month, year, and total revenue are required' });
    }

    incrementUsage(req.user.id);

    const systemPrompt = `You are a healthcare financial analyst and medical billing consultant with expertise in revenue cycle management (RCM), healthcare finance, and practice analytics. You create clear, insightful monthly billing reports that help practice administrators and physicians understand their financial performance, identify trends, and take action to improve revenue.`;

    const userMessage = `Create a comprehensive monthly billing performance report for:

Reporting Period: ${month} ${year}
Practice Specialty: ${specialty || 'General Medical Practice'}

Financial Metrics:
- Total Revenue Collected: $${totalRevenue}
- Previous Month Revenue: $${previousMonthRevenue || 'Not provided'}
- Total Claims Submitted: ${totalClaims || 'Not provided'}
- Denial Rate: ${denialRate || 'Not provided'}%
- Collection Rate: ${collectionRate || 'Not provided'}%
- Total Outstanding AR: $${outstandingAR || 'Not provided'}
- Average Days in AR: ${avgDaysInAR || 'Not provided'} days

Top Denial Reasons: ${topDenialReasons || 'Not provided'}
Top Payers: ${topPayers || 'Not provided'}

Please generate a complete monthly report including:

## Executive Summary
Key highlights and overall performance assessment in 3-5 bullet points

## Revenue Analysis
- Month-over-month comparison and trend analysis
- Revenue breakdown insights
- Performance against industry benchmarks

## Claims Performance
- Claims submission and processing analysis
- Denial rate analysis and root cause assessment
- Clean claim rate insights

## AR Management
- Aging bucket analysis
- Collection efficiency insights
- Payer-specific performance notes

## Top Issues & Root Causes
Analysis of the primary factors impacting performance

## Recommended Action Items
Prioritized list of specific, actionable steps for next month with expected impact

## Key Performance Indicators Dashboard
Summary table of KPIs with status indicators (on target / needs attention / critical)

Write in a professional tone suitable for presenting to practice leadership.`;

    await streamResponse(res, 'claude-sonnet-4-6', systemPrompt, userMessage);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate monthly report' });
    }
  }
});

// POST /api/tools/patient-statement
router.post('/patient-statement', authenticateToken, async (req, res) => {
  try {
    const { patientName, dob, accountNumber, serviceProvider, serviceDates, charges, insurancePaid, adjustments, patientBalance, dueDate, paymentOptions } = req.body;

    if (!patientName || !patientBalance) {
      return res.status(400).json({ error: 'Patient name and patient balance are required' });
    }

    incrementUsage(req.user.id);

    const systemPrompt = `You are an expert medical billing specialist with decades of experience creating patient-friendly billing statements. You create clear, professional, and easy-to-understand billing statements that include itemized charges, insurance adjustments, patient responsibility, and payment options. Your statements are accurate, compliant, and designed to minimize patient confusion while encouraging timely payment.`;

    const userMessage = `Create a professional patient billing statement with the following details:

Patient Name: ${patientName}
Date of Birth: ${dob || 'Not provided'}
Account Number: ${accountNumber || 'Not provided'}
Service Provider: ${serviceProvider || 'Not provided'}
Service Date(s): ${serviceDates || 'Not provided'}

Charges/Services Rendered:
${charges || 'Not provided'}

Insurance Payment: $${insurancePaid || '0'}
Contractual Adjustments: $${adjustments || '0'}
Patient Balance Due: $${patientBalance}
Payment Due Date: ${dueDate || '30 days from statement date'}
Payment Options: ${paymentOptions || 'Check, credit card, online payment portal'}

Please create a complete patient billing statement that includes:

1. **Statement Header** — Practice/provider name, statement date, account number, patient info

2. **Itemized Charges Table** — List each service with date, description, charge amount

3. **Insurance Summary** — What was billed, what insurance paid, adjustments applied

4. **Patient Responsibility Summary** — Clear breakdown of what the patient owes and why

5. **Payment Options Section** — How to pay, accepted methods, online portal info

6. **Patient-Friendly Explanation** — 2-3 sentences explaining the balance in plain language

7. **Contact Information Block** — Billing questions contact

Format it clearly so a patient with no medical billing knowledge can understand exactly what they owe and why.`;

    await streamResponse(res, 'claude-sonnet-4-6', systemPrompt, userMessage);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate patient statement' });
    }
  }
});

// POST /api/tools/prior-auth
router.post('/prior-auth', authenticateToken, async (req, res) => {
  try {
    const { patientName, dob, memberId, insurancePlan, providerName, npi, requestedService, cptCodes, diagnosisCodes, clinicalJustification, urgency, previousTreatments } = req.body;

    if (!patientName || !requestedService) {
      return res.status(400).json({ error: 'Patient name and requested service are required' });
    }

    incrementUsage(req.user.id);

    const systemPrompt = `You are an expert medical billing and prior authorization specialist with extensive experience writing successful prior authorization requests. You understand payer medical necessity criteria, clinical documentation requirements, and how to frame clinical information compellingly to obtain authorizations. You write requests that are thorough, evidence-based, and structured to maximize approval rates.`;

    const userMessage = `Write a comprehensive prior authorization request with the following details:

Patient Name: ${patientName}
Date of Birth: ${dob || 'Not provided'}
Member ID: ${memberId || 'Not provided'}
Insurance Plan: ${insurancePlan || 'Not provided'}
Requesting Provider: ${providerName || 'Not provided'}
NPI: ${npi || 'Not provided'}
Requested Service/Procedure: ${requestedService}
CPT Code(s): ${cptCodes || 'Not provided'}
Diagnosis Code(s): ${diagnosisCodes || 'Not provided'}
Urgency: ${urgency || 'Routine'}
Previous/Alternative Treatments Tried: ${previousTreatments || 'None documented'}

Clinical Justification:
${clinicalJustification || 'Not provided'}

Please write a complete prior authorization request letter that includes:

## Clinical Summary
Brief overview of the patient's condition and why treatment is needed

## Medical Necessity Justification
Detailed clinical rationale referencing:
- Relevant clinical guidelines (AHA, ACS, specialty society guidelines)
- Evidence-based criteria supporting the request
- How the patient meets medical necessity criteria

## Treatment History & Conservative Care
Summary of previous treatments tried and their outcomes (or why alternatives are not appropriate)

## Consequences of Denial
Clinical impact if the requested service is not authorized

## Supporting Documentation List
What documentation is attached to support the request

## Formal Request Statement
Clear, concise closing statement requesting authorization

Use formal, clinical language appropriate for insurance review teams.`;

    await streamResponse(res, 'claude-sonnet-4-6', systemPrompt, userMessage);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate prior authorization request' });
    }
  }
});

// POST /api/tools/eob-interpreter
router.post('/eob-interpreter', authenticateToken, async (req, res) => {
  try {
    const { eobText, patientName, additionalContext } = req.body;

    if (!eobText) {
      return res.status(400).json({ error: 'EOB text is required' });
    }

    incrementUsage(req.user.id);

    const systemPrompt = `You are an expert medical billing educator and patient advocate with deep knowledge of insurance Explanation of Benefits (EOB) documents. You excel at translating complex insurance language, denial codes, remark codes, and adjustment reason codes into clear, plain English that patients and billing staff can easily understand. You help identify whether amounts are correct, whether appeals are warranted, and what action steps to take.`;

    const userMessage = `Please interpret and explain the following Explanation of Benefits (EOB) document in plain English:

Patient Name: ${patientName || 'Not specified'}
Additional Context: ${additionalContext || 'None'}

EOB Document:
${eobText}

Please provide a comprehensive EOB interpretation that includes:

## Plain-English Summary
What this EOB means in 3-5 simple sentences — who paid what and what (if anything) the patient owes

## Line-by-Line Breakdown
For each service line:
- What the service was
- Amount billed vs. allowed amount
- What insurance paid and why
- What the patient is responsible for
- Any denial or adjustment codes explained in plain English

## Denial & Adjustment Code Explanations
If any services were denied or adjusted:
- Exact code and what it means
- Is this denial likely correct or potentially disputable?
- Recommended next step

## Action Items
Prioritized list of what the patient or billing staff should do next:
- Any amounts to verify or dispute
- Deadlines to be aware of
- Who to call and what to ask

## Red Flags
Any unusual denials, underpayments, or errors that should be investigated

Write in plain, friendly language a patient can understand — avoid insurance jargon without explanation.`;

    await streamResponse(res, 'claude-sonnet-4-6', systemPrompt, userMessage);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to interpret EOB' });
    }
  }
});

// POST /api/tools/charge-capture
router.post('/charge-capture', authenticateToken, async (req, res) => {
  try {
    const { clinicalNotes, chargesSubmitted, specialty, serviceDate, providerType, additionalContext } = req.body;

    if (!clinicalNotes) {
      return res.status(400).json({ error: 'Clinical notes are required' });
    }

    incrementUsage(req.user.id);

    const systemPrompt = `You are an expert charge capture auditor and certified medical coder with extensive experience in revenue cycle management. You are highly skilled at comparing clinical documentation against submitted charges to identify missed charges, incorrect codes, unbundling issues, downcoding, upcoding, and documentation gaps. Your reviews help practices capture all legitimate revenue while maintaining compliance with coding guidelines.`;

    const userMessage = `Perform a charge capture audit by comparing the clinical documentation against the submitted charges:

Specialty: ${specialty || 'General'}
Service Date: ${serviceDate || 'Not provided'}
Provider Type: ${providerType || 'Not specified'}
Additional Context: ${additionalContext || 'None'}

CLINICAL DOCUMENTATION:
${clinicalNotes}

CHARGES SUBMITTED:
${chargesSubmitted || 'No charges submitted — please review documentation only and suggest appropriate charges'}

Please provide a thorough charge capture review:

## Charges Audit Summary
Overall assessment — are charges complete, under-coded, over-coded, or missing items?

## Missing Charges
Services documented but NOT billed:
- Service/procedure identified in notes
- Suggested CPT code
- Clinical evidence from the notes
- Estimated value

## Incorrect or Questionable Charges
Charges that appear incorrect, unsupported, or miscoded:
- Current code submitted
- Issue identified
- Recommended correction
- Risk level (compliance risk, revenue impact)

## Documentation Gaps
Areas where documentation is insufficient to support billed charges:
- What's missing
- What needs to be added or clarified

## Bundling/Unbundling Issues
Any CPT bundling concerns (CCI edits, add-on codes, etc.)

## Compliance Notes
Any charges that raise compliance concerns and why

## Revenue Impact Summary
Estimated revenue impact of identified missed charges

Format findings clearly with specific code references.`;

    await streamResponse(res, 'claude-sonnet-4-6', systemPrompt, userMessage);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to perform charge capture review' });
    }
  }
});

// POST /api/tools/credentialing
router.post('/credentialing', authenticateToken, async (req, res) => {
  try {
    const { providerName, npi, specialty, licenseState, licenseNumber, deaNumber, boardCertifications, targetInsurers, documentType, additionalInfo } = req.body;

    if (!providerName || !documentType) {
      return res.status(400).json({ error: 'Provider name and document type are required' });
    }

    incrementUsage(req.user.id);

    const systemPrompt = `You are an expert provider credentialing specialist and enrollment coordinator with comprehensive knowledge of insurance credentialing processes, CAQH (Council for Affordable Quality Healthcare) applications, CMS enrollment, and payer-specific credentialing requirements. You help providers and credentialing staff complete enrollment paperwork accurately and efficiently, draft cover letters, and navigate the credentialing process.`;

    const userMessage = `Assist with the following provider credentialing document:

Document Type Needed: ${documentType}
Provider Name: ${providerName}
NPI: ${npi || 'Not provided'}
Specialty: ${specialty || 'Not provided'}
License State: ${licenseState || 'Not provided'}
License Number: ${licenseNumber || 'Not provided'}
DEA Number: ${deaNumber || 'Not provided'}
Board Certifications: ${boardCertifications || 'Not provided'}
Target Insurance Plans: ${targetInsurers || 'Not specified'}
Additional Information: ${additionalInfo || 'None'}

Please provide comprehensive credentialing assistance including:

## Document Overview
What this document is, why it's needed, and how it fits into the credentialing process

## Complete Document/Template
The full document, letter, or completed section requested, formatted professionally

## Required Supporting Documents Checklist
For this application/enrollment, list every document typically required:
- Document name
- Where to obtain it
- Format required (certified copy, original, etc.)
- Common pitfalls

## Step-by-Step Submission Process
1. How to submit this document
2. To whom and what contact information/portal to use
3. Typical processing timeline
4. How to follow up

## Common Mistakes to Avoid
Top errors that cause credentialing delays for this document type

## Pro Tips
Insider knowledge to speed up the credentialing process for this specific document

Format everything professionally and practically — this should be actionable guidance the provider or staff can use immediately.`;

    await streamResponse(res, 'claude-sonnet-4-6', systemPrompt, userMessage);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate credentialing document' });
    }
  }
});

module.exports = router;
