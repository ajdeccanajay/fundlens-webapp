**FUNDLENS**

Investment-Grade IC Memo Generation

Product & Engineering Specification

Version 1.0 \| February 2026

Prepared for: FundLens Engineering & Product

+-----------------------------------------------------------------------+
| **Document Purpose**                                                  |
|                                                                       |
| This specification defines the complete architecture, data flows,     |
| prompt engineering, and UX patterns for FundLens IC Memo Generation   |
| for Public US Equity Research (SEC filing-based). Built with specific |
| attention to Third Avenue Management pilot requirements including     |
| memo style replication, provocation integration, and                  |
| scratchpad-to-memo workflow.                                          |
+-----------------------------------------------------------------------+

**1. Executive Summary & Problem Statement**

**1.1 Why the Current IC Memo Generation Fails**

The current IC memo generation capability produces outputs that fall
below the standard required by institutional investors. Based on
systematic diagnosis, the failures cluster into three categories:

  ---------------- --------------------------- ---------------------------
  **Failure Mode** **Symptom**                 **Root Cause**

  **Generic        Memos read like ChatGPT     No memo template ingestion.
  Structure**      summaries. No firm-specific No style replication.
                   voice, analytical           System has no concept of
                   framework, or section       how THIS fund writes memos.
                   structure.                  

  **Weak Evidence  Claims lack precise         RAG retrieval returns
  Chain**          citations. Numbers appear   chunks without filing
                   without source filing,      metadata propagation.
                   page, or date. Analyst      Citation pipeline drops
                   cannot verify claims.       source context during
                                               summarization.

  **No Analytical  Memo restates facts from    Memo generation treated as
  Depth**          filings without analytical  summarization task rather
                   provocation. Does not       than analytical synthesis.
                   challenge thesis or surface No provocation layer, no
                   contradictions.             temporal analysis, no
                                               cross-filing contradiction
                                               detection integrated into
                                               generation.
  ---------------- --------------------------- ---------------------------

**1.2 What Investment-Grade Means**

An investment-grade IC memo is a document that a portfolio manager would
present to their investment committee to support a buy/sell/hold
decision. The bar is absolute:

-   **Every number traceable:** Each financial metric cites the exact
    filing (10-K FY2024, page 47) and can be verified in under 30
    seconds.

-   **Firm voice preserved:** The memo reads like it was written by an
    analyst at THIS fund, using their frameworks, their section
    structure, their analytical language.

-   **Thesis-driven, not summary-driven:** The memo takes a position,
    presents evidence for and against, and surfaces the key risks that
    would invalidate the thesis.

-   **Provocation-embedded:** Integrated challenges that force the IC to
    confront uncomfortable questions, not just validate the analyst's
    existing view.

-   **Analyst-augmenting:** Cuts IC memo prep from 2--3 hours to 30
    minutes while INCREASING analytical rigor, not decreasing it.

**1.3 Third Avenue Management Requirements (Ryan's Asks)**

Ryan from Third Avenue Management provided specific requirements during
the pilot scoping conversation that define the MVP bar:

  -------- ---------------------------- ------------------ -----------------
  **\#**   **Requirement**              **Priority**       **Status**

  1        Feed 20 past memos →         **P0 -- Pilot      Not Built
           FundLens replicates style    Gate**             
           and structure automatically                     

  2        Scratchpad content + Q&A     **P0 -- Pilot      Partially Built
           answers assemble into memo   Gate**             
           with one click                                  

  3        Every claim in memo has      **P0 -- Pilot      Broken
           traceable citation to        Gate**             
           specific filing and page                        

  4        Provocations surface in memo **P1 -- High       Not Built
           as "Key Risks & Challenges"  Impact**           
           section with data backing                       

  5        Cross-transcript theme       **P1 -- High       Not Built
           search results flow into     Impact**           
           memo evidence                                   

  6        Sell-side differential       P2 -- Polish       Not Built
           analysis as memo appendix                       
  -------- ---------------------------- ------------------ -----------------

**2. System Architecture**

**2.1 IC Memo Generation Pipeline Overview**

The memo generation system operates as a multi-stage pipeline with
deterministic data retrieval, intelligent synthesis, and template-aware
formatting. It is NOT a single LLM call. Each stage has explicit inputs,
outputs, and quality gates.

  ----------- ---------------------- ------------------------- -------------------------
  **Stage**   **Name**               **What It Does**          **Quality Gate**

  **1**       **Template             Loads firm-specific memo  Template must exist for
              Resolution**           template (learned from    firm. If no firm
                                     ingested sample memos).   template, use FundLens
                                     Determines section        default with warning.
                                     structure, formatting     Never generate without
                                     rules, analytical         structure.
                                     framework, and voice      
                                     characteristics.          

  **2**       **Data Assembly**      Gathers all inputs:       Every data item must
                                     scratchpad items, Q&A     carry source_filing,
                                     history, saved            source_page, source_date,
                                     provocations, analyst     and extraction_method
                                     thesis tracker state,     (deterministic vs. RAG).
                                     deterministic metric      Items without metadata
                                     extractions,              are quarantined.
                                     RAG-retrieved narrative   
                                     passages. Each data item  
                                     tagged with source        
                                     metadata.                 

  **3**       **Section-by-Section   For each section defined  Section output must
              Generation**           in the template: assemble include at least one
                                     relevant data subset,     citation per factual
                                     generate section content  claim. Claims without
                                     with inline citations,    citations flagged for
                                     apply firm voice and      analyst review. No
                                     analytical framing. Each  section may be empty.
                                     section is a separate LLM 
                                     call with focused         
                                     context.                  

  **4**       **Provocation          Injects relevant          At least 3 provocations
              Integration**          provocations as the "Key  required. Each must
                                     Risks &                   reference specific filing
                                     Counter-Arguments"        data. Provocations the
                                     section. Each provocation analyst has already
                                     includes: the challenge,  addressed in scratchpad
                                     the data backing it, the  get "Analyst Response"
                                     analyst's response (if    subsection.
                                     captured in scratchpad),  
                                     and the unresolved risk.  

  **5**       **Citation             Post-generation pass that Zero tolerance: any
              Verification**         verifies every citation.  citation that doesn't
                                     Cross-checks cited        match the source
                                     numbers against the       extraction is flagged
                                     deterministic extraction  with \[VERIFY\] tag. Memo
                                     database. Flags any       is never marked
                                     discrepancy between cited "complete" with
                                     value and source value.   unresolved flags.

  **6**       **Formatting &         Applies final formatting  DOCX must pass schema
              Export**               per firm template.        validation. Table
                                     Generates DOCX with       formatting must match
                                     proper styles, page       firm template. All
                                     numbers, TOC, and         citations must be
                                     FundLens watermark. Also  hyperlinked to source
                                     generates in-app preview. filings.
  ----------- ---------------------- ------------------------- -------------------------

**2.2 Data Flow Diagram**

The following describes the complete data flow from analyst interaction
to finished memo:

+-----------------------------------------------------------------------+
| **Data Sources → Assembly → Generation → Verification → Output**      |
|                                                                       |
| \[Scratchpad Items\] ──┐                                              |
|                                                                       |
| \[Q&A History\] ──┤                                                   |
|                                                                       |
| \[Saved Provocations\] ──┤──▶ \[Data Assembler\] ──▶ \[Section        |
| Generator\] ──▶ \[Citation Verifier\]                                 |
|                                                                       |
| \[Thesis Tracker State\] ──┤ (per-item (per-section (cross-check vs   |
|                                                                       |
| \[Deterministic Metrics\] ──┤ metadata) LLM call) source DB)          |
|                                                                       |
| \[RAG Narrative Chunks\] ──┘                                          |
|                                                                       |
| │                                                                     |
|                                                                       |
| \[Firm Memo Template\] ───────────────────────────────────▶ \[DOCX    |
| Formatter\]                                                           |
|                                                                       |
| │                                                                     |
|                                                                       |
| \[IC Memo DOCX + Preview\]                                            |
+-----------------------------------------------------------------------+

**3. Memo Template Learning System**

**3.1 Template Ingestion (Ryan's "Feed 20 Past Memos")**

This is the P0 pilot gate feature. The system must learn a firm's memo
style from sample documents and reproduce it faithfully.

**3.1.1 Ingestion Pipeline**

1.  **Upload Phase:** Analyst uploads 10--20 historical IC memos as DOCX
    or PDF files. System extracts text, preserving section headers,
    formatting hierarchy, and structural patterns.

2.  **Structure Extraction:** LLM analyzes all memos to identify the
    canonical section structure. Outputs: ordered list of sections with
    frequency (e.g., "Executive Summary" appears in 100% of memos,
    "Management Quality Assessment" appears in 85%).

3.  **Voice Fingerprinting:** LLM characterizes the firm's analytical
    voice across dimensions: formality level, use of data tables vs.
    prose, hedging language patterns, typical sentence structure,
    preferred financial terminology, how conclusions are framed.

4.  **Analytical Framework Detection:** Identifies the firm's preferred
    analytical frameworks: do they lead with valuation or business
    quality? Do they use DCF, comps, or asset-based valuation? How do
    they structure risk sections? What's their approach to management
    assessment?

5.  **Template Compilation:** Outputs a structured Memo Template Object
    stored per-firm in DynamoDB, containing: section_order,
    section_descriptions, voice_guide, formatting_rules,
    analytical_frameworks, and 3--5 representative excerpts per section
    as few-shot examples.

**3.1.2 Memo Template Object Schema**

+-----------------------------------------------------------------------+
| **MemoTemplate:**                                                     |
|                                                                       |
| firm_id: str \# Tenant identifier                                     |
|                                                                       |
| template_id: str \# Unique template version                           |
|                                                                       |
| created_from: List\[str\] \# Source memo file IDs                     |
|                                                                       |
| **sections:**                                                         |
|                                                                       |
| \- name: str \# e.g. \"Executive Summary\"                            |
|                                                                       |
| order: int \# Position in memo                                        |
|                                                                       |
| frequency: float \# How often it appears (0-1)                        |
|                                                                       |
| description: str \# What this section covers                          |
|                                                                       |
| data_sources: List\[str\] \# Which pipeline stages feed it            |
|                                                                       |
| example_excerpts: List\[str\] \# 3-5 representative passages          |
|                                                                       |
| typical_length: str \# e.g. \"2-3 paragraphs\"                        |
|                                                                       |
| **voice_guide:**                                                      |
|                                                                       |
| formality: str \# \"formal\" \| \"analytical-casual\"                 |
|                                                                       |
| data_presentation: str \# \"table-heavy\" \| \"prose-driven\"         |
|                                                                       |
| hedging_style: str \# How conclusions are qualified                   |
|                                                                       |
| preferred_terms: Dict\[str,str\] \# Firm-specific terminology map     |
|                                                                       |
| conclusion_framing: str \# How recommendations are stated             |
|                                                                       |
| **formatting_rules:**                                                 |
|                                                                       |
| page_limit: Optional\[int\] \# Max pages if firm has standard         |
|                                                                       |
| table_style: str \# How data tables are formatted                     |
|                                                                       |
| citation_style: str \# Inline, footnote, or endnote                   |
+-----------------------------------------------------------------------+

**3.2 Default FundLens Memo Template (No Sample Memos)**

When a firm has not uploaded sample memos, FundLens uses a high-quality
default template designed for deep-value equity analysis. This template
is opinionated and analytical, not generic.

  -------- --------------------- --------------------------- -------------------
  **\#**   **Section**           **Content**                 **Data Sources**

  1        **Investment Thesis** 1--2 paragraph thesis       Thesis Tracker
                                 statement with position     state, analyst
                                 (long/short/avoid),         position,
                                 conviction level, and 3 key conviction level
                                 reasons. Concise and        
                                 decisive.                   

  2        **Company Overview**  Business description,       10-K Item 1,
                                 segments, geographic mix,   segment data, RAG
                                 competitive positioning.    narrative retrieval
                                 NOT a Wikipedia summary --- 
                                 focused on what matters for 
                                 the thesis.                 

  3        **Financial           Key metrics table (5-year   Deterministic
           Analysis**            trends), margin analysis,   metric extraction
                                 capital allocation review,  (YAML registries),
                                 balance sheet assessment.   calculated metrics
                                 All deterministically       
                                 extracted.                  

  4        **Management &        Executive assessment,       DEF 14A, Form 4,
           Governance**          compensation alignment,     MD&A temporal
                                 insider transaction         analysis, earnings
                                 patterns, board             call sentiment
                                 independence. Uses MD&A     
                                 language drift analysis.    

  5        **Variant             Where does our view differ  Analyst scratchpad
           Perception**          from consensus? What does   notes, provocation
                                 the market miss? What are   responses,
                                 we seeing that others       sell-side
                                 aren't? This is the         differential
                                 analytical core.            analysis

  6        **Key Risks &         Provocations presented as   Provocation engine
           Counter-Arguments**   structured challenges. Each output,
                                 risk: the challenge, the    contradiction
                                 data, the analyst's         detector, temporal
                                 response, the residual      intelligence
                                 exposure.                   

  7        **Valuation**         Preferred valuation         Deterministic
                                 methodology with comps      metrics, analyst
                                 where applicable.           inputs from
                                 Sensitivity analysis on key scratchpad, comp
                                 assumptions. Target price   table data
                                 or range with timeline.     

  8        **Catalysts &         Upcoming events that could  Thesis tracker kill
           Monitoring Plan**     move the stock. What to     criteria, upcoming
                                 watch for. Kill criteria    filings, analyst
                                 --- what would invalidate   notes
                                 the thesis?                 
  -------- --------------------- --------------------------- -------------------

**4. Scratchpad-to-Memo Workflow**

**4.1 The Analyst Journey**

The IC memo is the output of a research process, not a standalone
generation task. The workflow must respect how analysts actually work:

  ----------- -------------- -------------------------- --------------------------
  **Phase**   **Analyst      **FundLens Behavior**      **Data Captured**
              Action**                                  

  **A**       **Research**   Analyst asks questions in  Every Q&A pair logged with
                             chat. Gets answers with    timestamp, company
                             citations. Explores        context, and source
                             filings. Runs              citations. Tagged by topic
                             provocations. Looks at     area automatically.
                             metrics.                   

  **B**       **Curate**     Analyst saves valuable     Scratchpad items: original
                             answers to Scratchpad.     Q&A + analyst
                             Adds notes, highlights,    annotations + ordering.
                             personal observations.     Each item retains full
                             Reorders items.            citation chain.

  **C**       **Thesis       Analyst sets position      Thesis state: position,
              Formation**    (Long/Short/Avoid),        conviction, reasoning,
                             conviction (1--5), and     kill criteria, variant
                             kill criteria in Thesis    perception notes.
                             Tracker.                   

  **D**       **Generate**   Analyst clicks "Generate   Full memo with audit trail
                             IC Memo." System assembles linking every claim back
                             all captured data, applies to source data item and
                             template, generates        original filing.
                             section-by-section with    
                             citations.                 

  **E**       **Refine**     Analyst reviews memo in    Edit history. Final
                             preview. Can edit inline,  version with analyst
                             regenerate individual      sign-off.
                             sections, add manual       
                             content, resolve           
                             \[VERIFY\] flags.          
  ----------- -------------- -------------------------- --------------------------

**4.2 Scratchpad Item Data Model**

+-----------------------------------------------------------------------+
| **ScratchpadItem:**                                                   |
|                                                                       |
| item_id: str                                                          |
|                                                                       |
| company_ticker: str                                                   |
|                                                                       |
| source_type: enum \# \"qa_answer\" \| \"provocation\" \|              |
| \"manual_note\" \| \"metric_snapshot\"                                |
|                                                                       |
| original_query: Optional\[str\] \# The question that produced this    |
|                                                                       |
| content: str \# The answer/note content                               |
|                                                                       |
| analyst_annotation: Optional\[str\] \# Analyst\'s added notes         |
|                                                                       |
| citations: List\[Citation\] \# Full citation chain preserved          |
|                                                                       |
| auto_tags: List\[str\] \# Auto-classified: \"valuation\", \"risk\",   |
| \"management\"                                                        |
|                                                                       |
| memo_section_hint: Optional\[str\] \# Which memo section this maps to |
|                                                                       |
| created_at: datetime                                                  |
|                                                                       |
| sort_order: int \# Analyst\'s manual ordering                         |
+-----------------------------------------------------------------------+

**4.3 Auto-Mapping Scratchpad Items to Memo Sections**

When the analyst clicks "Generate IC Memo," the system must
intelligently map scratchpad items to memo sections. This is a
classification task, not a generation task.

**Classification approach:** Use the auto_tags on each scratchpad item
plus the section descriptions from the memo template. Run a lightweight
classification (Claude Haiku is sufficient) to assign each item a
memo_section_hint. Items tagged "valuation" map to the Valuation
section. Items tagged "risk" or sourced from provocations map to Key
Risks. The analyst can override any mapping before generation.

**Critical rule:** No scratchpad item is discarded. If an item doesn't
fit a section, it goes into an "Additional Research Notes" appendix. The
analyst's work is never lost.

**5. Citation Architecture**

**5.1 The Citation Contract**

This is the non-negotiable standard. Every factual claim in the memo
must be traceable to its source in under 30 seconds. This is what
separates an investment-grade tool from a toy.

**5.1.1 Citation Object Schema**

+-----------------------------------------------------------------------+
| **Citation:**                                                         |
|                                                                       |
| filing_type: str \# \"10-K\" \| \"10-Q\" \| \"8-K\" \| \"DEF 14A\" \| |
| \"Earnings Call\"                                                     |
|                                                                       |
| filing_period: str \# \"FY2024\" \| \"Q3 2024\"                       |
|                                                                       |
| filing_date: str \# Date filed with SEC                               |
|                                                                       |
| section: str \# \"Item 7 - MD&A\" \| \"Note 12 - Leases\"             |
|                                                                       |
| page_number: Optional\[int\]                                          |
|                                                                       |
| extraction_method: str \# \"deterministic\" \| \"rag_semantic\" \|    |
| \"calculated\"                                                        |
|                                                                       |
| confidence: float \# 1.0 for deterministic, 0.0-1.0 for RAG           |
|                                                                       |
| edgar_url: Optional\[str\] \# Direct link to EDGAR filing             |
+-----------------------------------------------------------------------+

**5.1.2 Citation Display Formats**

  ------------------ -------------------------- --------------------------
  **Context**        **Format**                 **Example**

  **In-app memo      Superscript clickable      Revenue grew 12.4%¹ \...
  preview**          citation number. Click     \[1\] 10-K FY2024, Item 6,
                     expands to show full       p.47
                     source with link to        
                     filing.                    

  **DOCX export**    Inline parenthetical       Revenue grew 12.4% (10-K
                     citation with filing       FY2024, p.47) driven
                     reference. Footnotes for   by\...
                     extended context.          

  **Deterministic    Confidence indicator:      ● \$45.2B (deterministic)
  metrics**          solid dot for              vs ○ \~\$45B (RAG)
                     deterministic, hollow dot  
                     for RAG-extracted.         
  ------------------ -------------------------- --------------------------

**5.2 Citation Verification Pipeline**

After memo generation, every citation undergoes automated verification:

6.  **Numeric claims:** Cross-check the cited value against the
    deterministic extraction database. If the memo says "Revenue was
    \$45.2B" citing 10-K FY2024, verify that \$45.2B matches the
    extracted value exactly. Any mismatch gets a \[VERIFY\] flag.

7.  **Narrative claims:** For qualitative claims (e.g., "Management
    expressed caution on China"), verify that the cited filing section
    contains language supporting the claim. Use semantic similarity
    threshold of 0.75+ against the source chunk.

8.  **Fabrication detection:** Any claim that cites a filing/page
    combination where FundLens has no indexed content is flagged as
    potential fabrication. These get \[FABRICATION?\] flags and must be
    resolved before the memo can be marked complete.

**6. Provocation Integration in Memos**

**6.1 From Provocations to "Key Risks & Counter-Arguments"**

The provocation engine is FundLens's most differentiated capability. In
the IC memo, provocations transform from interactive challenges into
structured risk analysis.

**6.1.1 Provocation-to-Risk Mapping**

  -------------------- ------------------ ------------------ -----------------
  **Provocation Type** **Memo             **Required         **Example**
                       Presentation**     Elements**         

  **Contradiction      Presented as       Both contradicting MD&A claims
  Detected**           "Inconsistency in  data points with   margin expansion
                       Disclosure" with   exact citations.   while Note 14
                       both data points   Analyst's          shows
                       cited              reconciliation if  accelerating
                                          available.         warranty costs

  **Topic              Presented as       Timeline of        Cloud migration
  Disappearance**      "Disclosure Gap"   mentions with      revenue discussed
                       with timeline of   quarter            Q1--Q3 2024,
                       when topic was     references. Last   absent from Q4
                       discussed vs. when appearance date.   and FY2025 filing
                       it vanished        Possible           
                                          explanations.      

  **Metric             Presented as       Previous           Adjusted EBITDA
  Redefinition**       "Accounting Change definition with    now excludes
                       Alert" with old    citation. New      restructuring;
                       vs. new            definition with    previously
                       calculation        citation. Impact   included.
                       methodology        estimate if        Flatters margin
                                          calculable.        by 200bps.

  **Counter-Thesis**   Presented as       The bear/bull      If China revenue
                       "Alternative View" counter-case with  loss is
                       with data          specific data      structural (not
                       supporting the     points. What would cyclical), fair
                       opposing position  need to be true    value is 22x not
                                          for this view to   32x
                                          be right.          
  -------------------- ------------------ ------------------ -----------------

**6.2 Provocation Section Structure in Memo**

Each provocation in the memo follows a consistent 4-part structure:

+-----------------------------------------------------------------------+
| **RISK: \[Provocation Title\]**                                       |
|                                                                       |
| **The Challenge:** \[1--2 sentence provocation framed as a question   |
| the IC must address\]                                                 |
|                                                                       |
| **The Evidence:** \[Specific data points from filings with citations  |
| that support the risk\]                                               |
|                                                                       |
| **Analyst Response:** \[If the analyst addressed this in scratchpad,  |
| include their reasoning. If not: "Not yet addressed --- requires IC   |
| discussion."\]                                                        |
|                                                                       |
| **Residual Exposure:** \[Even after analyst's response, what risk     |
| remains? What would change our view?\]                                |
+-----------------------------------------------------------------------+

**7. Prompt Engineering Specification**

**7.1 Section Generation System Prompt**

Each memo section is generated with a dedicated LLM call. This prevents
context dilution and ensures each section gets focused attention. The
system prompt follows this structure:

+-----------------------------------------------------------------------+
| **SYSTEM PROMPT TEMPLATE: Section Generator**                         |
|                                                                       |
| \-\--                                                                 |
|                                                                       |
| You are writing the \"{section_name}\" section of an Investment       |
| Committee memo                                                        |
|                                                                       |
| for {company_name} ({ticker}) for the firm {firm_name}.               |
|                                                                       |
| \<voice_guide\>                                                       |
|                                                                       |
| {firm_voice_guide}                                                    |
|                                                                       |
| \</voice_guide\>                                                      |
|                                                                       |
| \<section_description\>                                               |
|                                                                       |
| {section_description_from_template}                                   |
|                                                                       |
| \</section_description\>                                              |
|                                                                       |
| \<example_excerpts\>                                                  |
|                                                                       |
| {3-5 example passages from the firm\'s past memos for this section}   |
|                                                                       |
| \</example_excerpts\>                                                 |
|                                                                       |
| \<available_data\>                                                    |
|                                                                       |
| {scratchpad items and data mapped to this section, with full          |
| citations}                                                            |
|                                                                       |
| \</available_data\>                                                   |
|                                                                       |
| **RULES:**                                                            |
|                                                                       |
| 1\. Every factual claim MUST include a citation in format: (Filing    |
| Period, Section, p.XX)                                                |
|                                                                       |
| 2\. If you cannot cite a claim, do NOT include it. Tag as \[NEEDS     |
| SOURCE\].                                                             |
|                                                                       |
| 3\. Match the voice guide exactly. Use the firm\'s terminology, not   |
| generic language.                                                     |
|                                                                       |
| 4\. Write for the IC audience: senior portfolio managers who want     |
| insight, not summary.                                                 |
|                                                                       |
| 5\. Target length: {typical_length_from_template}                     |
|                                                                       |
| 6\. Output as structured JSON with content and citations array for    |
| verification.                                                         |
+-----------------------------------------------------------------------+

**7.2 LLM Call Strategy**

  ---------------------- ------------------ ----------------- -----------------
  **Task**               **Model**          **Reasoning**     **Estimated
                                                              Latency**

  **Template learning    Claude Opus        Complex           One-time: 30--60s
  from sample memos**                       structural        per memo
                                            analysis          
                                            requiring deep    
                                            understanding of  
                                            analytical        
                                            writing           

  **Scratchpad item      Claude Haiku       Simple            Real-time:
  auto-tagging**                            classification    \<500ms per item
                                            task, high volume 

  **Section-by-section   Claude Sonnet /    Core generation   Per section:
  generation**           Opus               requires strong   5--15s
                                            writing and       
                                            citation          
                                            discipline. Opus  
                                            for Key Risks     
                                            section.          

  **Citation             Deterministic +    Numeric           Full memo: 3--5s
  verification**         Haiku              verification is   
                                            deterministic.    
                                            Narrative         
                                            verification uses 
                                            Haiku for         
                                            semantic          
                                            similarity.       

  **Section regeneration Same as original   Use same model as Per section:
  (user request)**                          initial           5--15s
                                            generation for    
                                            consistency       
  ---------------------- ------------------ ----------------- -----------------

**8. API Specification**

**8.1 Core Endpoints**

  ------------ ------------------------------------------------------ ----------------------------------
  **Method**   **Endpoint**                                           **Description**

  **POST**     /api/v1/memo/templates/learn                           Upload sample memos for template
                                                                      learning. Accepts multipart upload
                                                                      of 5--30 DOCX/PDF files. Returns
                                                                      template_id when processing
                                                                      completes (async).

  **GET**      /api/v1/memo/templates/{template_id}                   Retrieve learned template details
                                                                      including section structure, voice
                                                                      guide, and formatting rules.

  **POST**     /api/v1/memo/generate                                  Generate IC memo. Body: {
                                                                      company_ticker, template_id,
                                                                      scratchpad_item_ids,
                                                                      include_provocations: bool,
                                                                      sections_to_generate: \[\"all\" \|
                                                                      specific\] }. Returns memo_id for
                                                                      polling.

  **GET**      /api/v1/memo/{memo_id}/status                          Poll generation status. Returns: {
                                                                      status: \"generating\" \|
                                                                      \"verifying\" \| \"complete\" \|
                                                                      \"needs_review\",
                                                                      sections_completed: int,
                                                                      total_sections: int, verify_flags:
                                                                      int }.

  **GET**      /api/v1/memo/{memo_id}/preview                         Get memo content as structured
                                                                      JSON for in-app preview rendering.
                                                                      Includes inline citations and
                                                                      \[VERIFY\] flags.

  **POST**     /api/v1/memo/{memo_id}/sections/{section}/regenerate   Regenerate a single section with
                                                                      optional analyst instructions
                                                                      (e.g., "emphasize the margin
                                                                      compression more").

  **POST**     /api/v1/memo/{memo_id}/export                          Export to DOCX. Applies firm
                                                                      template formatting. Returns
                                                                      download URL.

  **PATCH**    /api/v1/memo/{memo_id}/sections/{section}              Manual edit to a section. Analyst
                                                                      can override generated content.
                                                                      Preserves edit history.

  **POST**     /api/v1/memo/{memo_id}/verify                          Re-run citation verification after
                                                                      manual edits. Returns updated
                                                                      verify_flags count.
  ------------ ------------------------------------------------------ ----------------------------------

**9. Implementation Plan**

**9.1 Phase 1: Foundation (Weeks 1--3) --- Pilot Gate**

Everything Ryan needs to say "yes, I'll trial this with a real
position."

  -------- ------------------------ --------------------- ---------------------
  **\#**   **Deliverable**          **Dependencies**      **Success Criteria**

  1.1      Memo Template Learning   DOCX/PDF text         Template correctly
           Pipeline --- accept      extraction            identifies \>90% of
           10--20 sample memos and  (existing). Claude    sections from Third
           produce template object  Opus API.             Avenue samples

  1.2      Citation metadata        RAG pipeline fix.     100% of deterministic
           propagation --- fix      Deterministic         metrics have complete
           broken citation pipeline extraction metadata.  Citation objects.
           so every data item                             95%+ of RAG chunks
           carries full source                            have filing + section
           metadata through to memo                       metadata.
           output                                         

  1.3      Scratchpad data model    Existing scratchpad.  Items auto-tagged
           upgrade --- add          Haiku classification. within 500ms. Tags
           auto-tagging, citation                         achieve \>85%
           chain preservation, and                        accuracy on manual
           memo section hints                             review.

  1.4      Section-by-section       Items 1.1, 1.2, 1.3   Generated memo
           generation with          complete.             matches firm template
           citations --- core                             structure. Every
           generation pipeline                            factual claim has
           using template +                               citation. No
           assembled data                                 \[FABRICATION?\]
                                                          flags on test set.
  -------- ------------------------ --------------------- ---------------------

**9.2 Phase 2: Verification & Polish (Weeks 4--5)**

  -------- ------------------------ --------------------- ---------------------
  **\#**   **Deliverable**          **Dependencies**      **Success Criteria**

  2.1      Citation verification    Deterministic         Zero false positives
           pipeline --- automated   extraction DB. Phase  on numeric
           cross-check of all       1 complete.           verification. \<5%
           citations against source                       false positive rate
           database                                       on narrative
                                                          verification.

  2.2      Provocation integration  Provocation engine.   At least 3
           --- provocations flow    Scratchpad            provocations per
           into Key Risks section   provocation items.    memo. Each has all 4
           with 4-part structure                          parts (challenge,
                                                          evidence, response,
                                                          residual).

  2.3      DOCX export with firm    Template formatting   Export passes
           formatting ---           rules. DOCX           validation.
           professional export      generation (docx-js). Formatting matches
           matching firm template                         firm samples to
           styling                                        partner satisfaction.

  2.4      Section regeneration &   Generation pipeline.  Regeneration
           inline editing ---       Preview UI.           preserves other
           analyst can refine                             sections. Edit
           individual sections or                         history maintained.
           override content                               \[VERIFY\] flags
                                                          update on re-verify.
  -------- ------------------------ --------------------- ---------------------

**9.3 Phase 3: Advanced Capabilities (Weeks 6--8)**

-   Cross-transcript theme search results flowing into memo evidence

-   Sell-side differential analysis as memo appendix

-   Fund mandate grounding --- memo auto-flags where company
    doesn't match fund criteria

-   Memo versioning and diff --- track how the thesis evolves as new
    filings are processed

**10. Success Metrics**

  --------------------- ---------------- ------------------ ----------------
  **Metric**            **Target**       **Measurement**    **Failure
                                                            Threshold**

  **Citation accuracy   **100%**         Automated:         Any numeric
  (numeric)**                            deterministic      mismatch is
                                         cross-check        unacceptable
                                         against source DB  

  **Citation coverage** \>95% of claims  Automated: ratio   \<85% triggers
                        cited            of cited claims to pipeline review
                                         total claims per   
                                         section            

  **Template fidelity** \>90% section    Analyst review:    \<75% means
                        match            does the memo      template
                                         match their firm's learning needs
                                         structure and      rework
                                         voice?             

  **Generation time     \<90 seconds     End-to-end from    \>3 minutes
  (full memo)**                          "Generate" click   breaks workflow
                                         to preview         
                                         available          

  **Analyst time        60--70%          Self-reported:     \<30% means
  savings**             reduction        time to produce    insufficient
                                         IC-ready memo vs.  value
                                         manual             

  **Provocations per    \>3 substantive  Automated count +  \<2 or rated
  memo**                                 analyst quality    "generic" means
                                         rating             engine needs
                                                            tuning

  **\[VERIFY\] flag     \<5% of claims   Automated: flags   \>15% means
  rate**                                 per total claims   citation
                                         ratio              pipeline is
                                                            broken

  **Zero fabrication    **0              Automated:         Any fabrication
  tolerance**           fabrications**   \[FABRICATION?\]   is a critical
                                         flag count         incident
  --------------------- ---------------- ------------------ ----------------

**11. Architectural Principles**

These principles govern all IC memo generation decisions and should be
referenced during code review:

17. **Deterministic when you can. Intelligent when you must.** Financial
    metrics come from deterministic extraction. Analytical synthesis
    comes from LLM. Never use LLM for what a database lookup can answer.

18. **No claim without a trail.** Every number, every assertion in the
    memo must trace back to a source. If you can't cite it, don't say
    it.

19. **The analyst's voice, not ours.** The memo should read like the
    analyst wrote it. FundLens is invisible infrastructure, not a
    co-author.

20. **Provoke, don't validate.** The memo's job is to make the IC
    smarter, not to confirm the analyst's existing view. Every memo must
    contain genuine challenges.

21. **Fail loud, never fail silent.** A \[VERIFY\] flag is infinitely
    better than a wrong number. A \[NEEDS SOURCE\] tag is infinitely
    better than a fabricated citation. The system must never present
    uncertain information as fact.

22. **Section-by-section, never monolithic.** Generate each section as a
    focused task with dedicated context. This prevents context dilution,
    enables targeted regeneration, and produces better output than a
    single massive prompt.

**End of Specification**

*FundLens --- Investment-Grade Intelligence*
