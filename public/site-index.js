/* ===================== KiteSink site index =====================
   ONE list of everything on the site. Three things read it:

     • the Find palette (⌘K / Ctrl K / "/") on every page
     • /library — the full index, grouped into shelves
     • the home page's library search

   Add a page → add a line here and it shows up in all three.
   `python3 scripts/check_site.py` fails if an entry points at a page that
   doesn't exist, or if a public page is missing from this list — so nothing
   on the site can quietly become unreachable.

   Fields:
     t  title                       h  href (path, #anchor or full URL)
     s  section: consulting | fitness | music | library | about
     k  kind — Section, Project, Tool, Notes, Game, Page, Docs, Legal, Feed
     d  one-line description        w  extra search words (optional)
     shelf  which Library shelf it sits on (see SHELVES below)
     now    true = current work; surfaced first in Find and on Library
     status optional pill text      wip: true styles the pill brass
     ext    true = opens in a new tab

   Blog posts are NOT listed here — they come from /blog/posts.js.
   ============================================================== */
window.KS_SHELVES = [
  { id: "current",  title: "Current projects", note: "What's being built and run right now." },
  { id: "tools",    title: "Tools & notes",    note: "Free calculators and plain-language references." },
  { id: "games",    title: "Games",            note: "One I make, and the page for the ones I love." },
  { id: "writing",  title: "Writing",          note: "The log — essays, devlogs and things worth reading." },
  { id: "workshop", title: "The workshop",     note: "Indexes and the pages about how this place runs." },
  { id: "docs",     title: "Docs & legal",     note: "Roadmaps, changelogs, support and policies." }
];

window.KS_INDEX = [
  /* ---------- the five sections ---------- */
  { t: "Consulting", h: "/consulting", s: "consulting", k: "Section", shelf: "current", now: true,
    d: "Workflow automation, operations and practical AI for music teams.", w: "hire services kitesink consulting business" },
  { t: "Fitness", h: "/fitness", s: "fitness", k: "Section", shelf: "current", now: true,
    d: "Vantix, six free calculators, and a sourced field guide to search or read by area.", w: "training nutrition lifting gym health powerlifting hypertrophy diet" },
  { t: "Music", h: "/music", s: "music", k: "Section", shelf: "current", now: true,
    d: "A sourced field guide to music royalties and rights, plus Song of the Day, Stage First and the Album Listening Club.", w: "songs albums musicians royalties rights publishing songwriters field guide" },
  { t: "Library", h: "/library", s: "library", k: "Section", shelf: "workshop",
    d: "Everything on the site in one index.", w: "archive all pages sitemap index everything" },
  { t: "About", h: "/about", s: "about", k: "Section", shelf: "workshop",
    d: "Who's behind KiteSink and how to reach me.", w: "truman bio contact" },

  /* ---------- consulting ---------- */
  { t: "Consulting services", h: "/consulting#services", s: "consulting", k: "Page", shelf: "current",
    d: "Workflow automation · operations improvements · AI and data solutions.", w: "automation operations ai data music labels artist teams" },
  { t: "How a project runs", h: "/consulting#process", s: "consulting", k: "Page", shelf: "current",
    d: "Understand the workflow, agree the scope, build and test, hand over.", w: "process steps scope" },
  { t: "AI concierge", h: "/consulting#concierge", s: "consulting", k: "Project", shelf: "current", now: true, status: "New", wip: true,
    d: "I learn your industry, observe the work, and automate what slows it down.", w: "assistant automation workflow observe zoom custom software deterministic ongoing one-time" },
  { t: "Start a conversation", h: "/consulting#contact", s: "consulting", k: "Page", shelf: "current",
    d: "Tell me what's slowing you down — a few sentences is enough.", w: "contact email hire inquiry" },

  /* ---------- fitness ---------- */
  { t: "Vantix", h: "/vantix", s: "fitness", k: "Project", shelf: "current", now: true, status: "In progress", wip: true,
    d: "The periodization OS. Free from the start; the core app is in progress.", w: "fitness os app training volume mev mrv mesocycle periodization flagship" },
  { t: "Energy & macro calculator", h: "/fitness#macros", s: "fitness", k: "Tool", shelf: "tools", now: true,
    d: "Maintenance calories, a target for your goal, and protein / carbs / fat.", w: "tdee bmr calories macros protein deficit surplus cut bulk mifflin meal plan prompt" },
  { t: "Effective reps explorer", h: "/fitness#reps", s: "fitness", k: "Tool", shelf: "tools", now: true,
    d: "See how reps in reserve changes what a set is worth, then tally a session.", w: "rir rpe failure hard sets volume hypertrophy" },
  { t: "1RM & load calculator", h: "/fitness#loads", s: "fitness", k: "Tool", shelf: "tools", now: true,
    d: "Estimate a one-rep max and get the load for any reps × RIR target.", w: "one rep max epley brzycki percentage table strength" },
  { t: "Travel workout builder", h: "/fitness#travel", s: "fitness", k: "Tool", shelf: "tools", now: true,
    d: "Pick the kit you have and the minutes you've got; get a session.", w: "hotel bodyweight dumbbell kettlebell emom amrap circuit generator home" },
  { t: "Meet attempt planner", h: "/fitness#attempts", s: "fitness", k: "Tool", shelf: "tools", now: true,
    d: "Openers, seconds and thirds for a powerlifting meet, with a warm-up ladder.", w: "powerlifting competition opener attempts squat bench deadlift total" },
  { t: "Diet planner", h: "/fitness#plan", s: "fitness", k: "Tool", shelf: "tools", now: true,
    d: "Your weekly deficit: choose how many days a week you diet, and see each day and what it must cover.", w: "diet plan weekly deficit calories diet days surplus cut bulk week intermittent fasting maintenance protein fibre" },
  { t: "Fitness field guide", h: "/fitness#guide", s: "fitness", k: "Notes", shelf: "tools", now: true,
    d: "Sourced entries by area. Search them all, or pick an area to read.", w: "training nutrition guide evidence reference notes search areas" },
  /* the pages under /fitness/, in the order of the hub: one line each */
  { t: "Training basics", h: "/fitness/basics", s: "fitness", k: "Notes", shelf: "tools",
    d: "Starting out and building a first programme: loads, warm-ups, classic methods, time frames.", w: "beginner novice programme program routine sets reps warm-up progression standards" },
  { t: "Lifting technique", h: "/fitness/technique", s: "fitness", k: "Notes", shelf: "tools",
    d: "How to do the main lifts: bench press, rows, deadlifts, squats, breathing and grip.", w: "form cues bench press row pulldown deadlift squat leg press bracing straps emg" },
  { t: "Hypertrophy notes", h: "/fitness/hypertrophy", s: "fitness", k: "Notes", shelf: "tools",
    d: "Training for muscle size: volume, effort, frequency, exercise choice, deloads.", w: "muscle growth sets reps failure rir bodybuilding" },
  { t: "Powerlifting notes", h: "/fitness/powerlifting", s: "fitness", k: "Notes", shelf: "tools",
    d: "A bigger squat, bench press and deadlift: percentages, RPE, periodisation, peaking.", w: "strength squat bench deadlift programming taper" },
  { t: "Your first powerlifting meet", h: "/fitness/meet", s: "fitness", k: "Notes", shelf: "tools",
    d: "From signing up to the last deadlift, in order, with a bag checklist.", w: "competition weigh-in attempts commands federation ipf checklist meet day" },
  { t: "Conditioning notes", h: "/fitness/conditioning", s: "fitness", k: "Notes", shelf: "tools",
    d: "Cardio and intervals, and how they fit with lifting: zones, HIIT, fat loss, sprints.", w: "cardio aerobic hiit intervals zone 2 steady state fasted epoc sprint" },
  { t: "Recovery notes", h: "/fitness/recovery", s: "fitness", k: "Notes", shelf: "tools",
    d: "Rest, fatigue and coming back: overreaching, rest days, soreness, layoffs.", w: "overtraining overreaching rest day doms soreness layoff detraining fatigue stress" },
  { t: "Nutrition notes", h: "/fitness/nutrition", s: "fitness", k: "Notes", shelf: "tools",
    d: "Eating to support training, and tracking food accurately.", w: "protein carbs calories macros supplements creatine tracking" },
  { t: "Diet notes", h: "/fitness/diet", s: "fitness", k: "Notes", shelf: "tools",
    d: "Losing or gaining weight on purpose: deficit size, plateaus, diet breaks, bulking.", w: "fat loss cut bulk deficit surplus weight plateau" },
  { t: "Body composition notes", h: "/fitness/bodycomp", s: "fitness", k: "Notes", shelf: "tools",
    d: "Fat, lean mass and how to track them: body fat levels, water, metabolic rate, limits.", w: "body fat percentage lean mass dexa calipers scale water weight leptin metabolism ffmi partitioning" },
  { t: "Training and nutrition research in women", h: "/fitness/women", s: "fitness", k: "Notes", shelf: "tools",
    d: "What the research on women shows: strength, muscle, the menstrual cycle, energy availability.", w: "female menstrual cycle contraception pill energy availability period sex differences" },
  { t: "Health notes", h: "/fitness/health", s: "fitness", k: "Notes", shelf: "tools",
    d: "Training for a long working life: activity targets, cardio, strength, markers.", w: "longevity zone 2 vo2 max steps blood pressure ageing" },
  { t: "Fitness claims, checked", h: "/fitness/claims", s: "fitness", k: "Notes", shelf: "tools", now: true,
    d: "Common training and nutrition claims, each with a verdict and its source.", w: "myths true false protein creatine failure fasting verdict" },
  { t: "Fitness glossary", h: "/fitness/glossary", s: "fitness", k: "Notes", shelf: "tools",
    d: "Training and nutrition terms in plain words.", w: "definitions rir rpe tdee mev mrv terms" },
  { t: "Key fitness numbers and tables", h: "/fitness/reference", s: "fitness", k: "Notes", shelf: "tools",
    d: "The figures worth knowing and the look-up tables, each linked to the page that holds it.", w: "reference protein sets steps percentages rpe chart weight classes rep ranges lookup" },
  { t: "Fitness sources and corrections", h: "/fitness/sources", s: "fitness", k: "Notes", shelf: "tools",
    d: "How entries are graded, what has been corrected, and every source.", w: "references citations studies papers evidence grading corrections log" },
  { t: "Vantix privacy", h: "/vantix/privacy", s: "fitness", k: "Legal", shelf: "docs",
    d: "How Vantix handles training and health data, in plain language.", w: "data policy" },

  /* ---------- music ---------- */
  { t: "Music field guide", h: "/music#guide", s: "music", k: "Notes", shelf: "tools", now: true,
    d: "Sourced entries on music royalties and rights, by area and reader. Search them all, or pick an area to read.", w: "royalties rights publishing songwriter artist producer label guide evidence reference search areas" },
  /* the pages under /music/, in the order of the hub: one line each */
  { t: "Royalty basics", h: "/music/royalty-basics", s: "music", k: "Notes", shelf: "tools",
    d: "The two copyrights in a song, the royalties each one earns, and who collects and pays them.", w: "composition recording master publishing performance mechanical neighbouring sync royalty streams" },
  { t: "Mechanical royalties and the MLC", h: "/music/mechanicals-mlc", s: "music", k: "Notes", shelf: "tools",
    d: "US mechanical rates, the Mechanical Licensing Collective, registering and matching works.", w: "mechanicals mlc statutory rate section 115 blanket licence phonorecords crb streaming" },
  { t: "Unclaimed royalties", h: "/music/unclaimed-recovery", s: "music", k: "Notes", shelf: "tools",
    d: "Why money goes unmatched, where it is held, and how to search for it and claim it.", w: "unclaimed black box unmatched royalties claim search recovery mlc soundexchange" },
  { t: "AI and music rights", h: "/music/ai-rights", s: "music", k: "Notes", shelf: "tools",
    d: "Training on songs and recordings, who owns AI-assisted work, voice and likeness, licensing deals, and the court cases so far.", w: "ai artificial intelligence training generative suno udio likeness voice no fakes copyright office deals lawsuits eu ai act" },
  { t: "Music claims, checked", h: "/music/claims", s: "music", k: "Notes", shelf: "tools", now: true,
    d: "Common claims about royalties, rights and the music business, each with a verdict and its source.", w: "myths true false verdict royalties streaming ai splits unclaimed" },
  { t: "Music business glossary", h: "/music/glossary", s: "music", k: "Notes", shelf: "tools",
    d: "Royalty and rights terms in plain words.", w: "definitions terms iswc isrc ipi pro mechanical letter of direction" },
  { t: "Key music numbers and tables", h: "/music/reference", s: "music", k: "Notes", shelf: "tools",
    d: "The dated key numbers and look-up tables, each linked to the page that holds it.", w: "reference rates percentages tables lookup statutory rate" },
  { t: "Music sources and grading", h: "/music/sources", s: "music", k: "Notes", shelf: "tools",
    d: "How music entries are graded, and every source they cite.", w: "references citations statutes regulations rulings collecting societies grading" },
  { t: "Claimable music royalties", h: "/music/claimable", s: "music", k: "Notes", shelf: "tools",
    d: "Where unclaimed music royalties are held, by holder and territory, and how each one is claimed.", w: "unclaimed royalties holders territory claim deadline mlc soundexchange ppl cmrra data" },
  { t: "Music rights tools", h: "/music/tools", s: "music", k: "Tool", shelf: "tools", now: true,
    d: "A mechanical rate calculator, an unclaimed-money checklist, an identifier checker, a split-sheet generator and a checked directory.", w: "calculator mechanical rate checklist isrc iswc isni ipi check digit split sheet directory" },
  { t: "Song of the Day", h: "/song-of-the-day", s: "music", k: "Project", shelf: "current", now: true, status: "Coming soon",
    d: "One curated song every day, with the story behind it. An iOS app.", w: "sotd daily music discovery iphone app" },
  { t: "Stage First", h: "/stage-first", s: "music", k: "Project", shelf: "current", now: true, status: "Prototype", wip: true,
    d: "The business side of a live show: a staffing app in staging beta, and a ticket-report closeout at design stage.", w: "backline gig sub musicians bands venues booking sos promoter closeout settlement ticket report" },
  { t: "Album Listening Club", h: "/listening-club", s: "music", k: "Project", shelf: "current", now: true, status: "Back 30 Jan 2027",
    d: "Three albums, one quiet afternoon, the last Saturday of the month. Starting fresh for 2027.", w: "discord club albums listening session community saturday monthly" },
  { t: "Song of the Day support", h: "/song-of-the-day/support", s: "music", k: "Docs", shelf: "docs",
    d: "Answers, troubleshooting and a direct line.", w: "help contact sotd" },
  { t: "Song of the Day privacy", h: "/song-of-the-day/privacy", s: "music", k: "Legal", shelf: "docs",
    d: "How the app handles your data.", w: "policy sotd" },
  { t: "Song of the Day terms", h: "/song-of-the-day/terms", s: "music", k: "Legal", shelf: "docs",
    d: "The terms for using the app.", w: "tos sotd" },

  /* ---------- library ---------- */
  { t: "Campground Tycoon", h: "/campground-tycoon", s: "library", k: "Game", shelf: "games", status: "Live · demo",
    d: "An isometric campground sim — the demo plays in your browser.", w: "game tycoon itch play pixel" },
  { t: "Campground Tycoon — features", h: "/campground-tycoon/features", s: "library", k: "Game", shelf: "games",
    d: "Living regions, five kinds of camper, the CAMP·OS terminal.", w: "game" },
  { t: "Campground Tycoon — regions", h: "/campground-tycoon/regions", s: "library", k: "Game", shelf: "games",
    d: "The folded park map: every region and its landscape family.", w: "game map" },
  { t: "Campground Tycoon — roadmap", h: "/campground-tycoon/roadmap", s: "library", k: "Docs", shelf: "games",
    d: "The dev trail so far, plus a suggestion box.", w: "game updates eras" },
  { t: "Games", h: "/games", s: "library", k: "Page", shelf: "games",
    d: "The game I make and the games I love.", w: "recommendations play" },
  { t: "Writing — the log", h: "/blog", s: "library", k: "Page", shelf: "workshop",
    d: "Essays, devlogs and reposts, newest first.", w: "blog posts essays log" },
  { t: "Atom feed", h: "/feed.xml", s: "library", k: "Feed", shelf: "docs",
    d: "Subscribe to the log in a feed reader.", w: "rss subscribe" },
  { t: "Now", h: "/now", s: "about", k: "Page", shelf: "workshop",
    d: "What I'm on at the moment.", w: "current status update" },
  { t: "Uses", h: "/uses", s: "about", k: "Page", shelf: "workshop",
    d: "The gear and software behind the workshop.", w: "setup tools hardware apps" },
  { t: "Colophon", h: "/colophon", s: "library", k: "Page", shelf: "workshop",
    d: "How this site is built.", w: "stack static html cloudflare" }
];
