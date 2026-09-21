import Link from "next/link";

const FEATURES = [
  { title: "Online bookings", text: "A booking page and widget for your website and Instagram bio. Customers pick a service, time and zone." },
  { title: "Cleaner scheduling", text: "Assign jobs, see who is free, and track completion from one calendar." },
  { title: "M-Pesa payments", text: "Send invoices and get paid with mobile money. Match every payment to a job." },
  { title: "WhatsApp inbox", text: "Every enquiry, reminder and receipt goes through WhatsApp — where your customers already are." },
  { title: "Customer records", text: "Addresses, preferences, visit history and ratings for every home and office." },
  { title: "Reports", text: "Revenue, busiest zones and top cleaners at a glance. Know what earns." },
];

const STEPS = [
  { n: "1", title: "Create your business", text: "Sign up, add branches and set your zones." },
  { n: "2", title: "Add services & prices", text: "Home cleaning, office, sofa, post-construction — with your rates." },
  { n: "3", title: "Take bookings", text: "Share your booking link. Jobs land on your calendar automatically." },
];

const FAQS = [
  { q: "Do my customers need to install anything?", a: "No. They book through a web link and chat on WhatsApp. Only your team uses the dashboard." },
  { q: "How do M-Pesa payments work?", a: "You send an invoice with a payment prompt. Customers pay with M-Pesa and the payment is recorded against the job." },
  { q: "Can I manage multiple branches?", a: "Yes. Each branch has its own zones, staff and schedule under one business account." },
  { q: "Is there a free trial?", a: "Yes — 14 days free, no card required. Bring your team when you are ready." },
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-col bg-white text-zinc-900">
      <header className="sticky top-0 z-10 border-b border-zinc-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <span className="text-lg font-bold tracking-tight text-[#0d7a5f]">Safi</span>
          <nav className="hidden items-center gap-6 text-sm text-zinc-600 sm:flex">
            <a href="#features" className="hover:text-zinc-900">Features</a>
            <a href="#how" className="hover:text-zinc-900">How it works</a>
            <a href="#pricing" className="hover:text-zinc-900">Pricing</a>
            <a href="#faq" className="hover:text-zinc-900">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-full px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100">Sign in</Link>
            <Link href="/register" className="rounded-full bg-[#0d7a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0b6a52]">Start Free Trial</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-10">
        {/* Hero */}
        <section className="flex flex-col items-center gap-5 py-8 text-center">
          <p className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-[#0d7a5f]">Built for Tanzanian cleaning businesses</p>
          <h1 className="max-w-2xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Run Your Cleaning Business From One Place.
          </h1>
          <p className="max-w-xl text-lg text-zinc-600">
            Bookings, customers, cleaners, payments and WhatsApp communication — all in one platform.
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link href="/register" className="rounded-full bg-[#0d7a5f] px-7 py-3 text-center text-base font-semibold text-white hover:bg-[#0b6a52]">Start Free Trial</Link>
            <Link href="#pricing" className="rounded-full border border-zinc-200 px-7 py-3 text-center text-base font-semibold text-zinc-800 hover:bg-zinc-50">Book a Demo</Link>
          </div>
          <p className="text-sm text-zinc-500">14 days free · No card required · M-Pesa ready</p>
        </section>

        {/* Problem / solution */}
        <section className="grid gap-4 rounded-3xl bg-zinc-50 p-6 sm:grid-cols-2 sm:p-8">
          <div>
            <h2 className="text-xl font-bold">The problem</h2>
            <p className="mt-2 text-zinc-600">Bookings lost in WhatsApp chats. Cleaners double-booked. Payments chased for weeks. Growth stuck on paper and memory.</p>
          </div>
          <div>
            <h2 className="text-xl font-bold">The solution</h2>
            <p className="mt-2 text-zinc-600">One dashboard: every booking, job, customer, invoice and WhatsApp message in order — so nothing slips and everyone knows what to do next.</p>
          </div>
        </section>

        {/* Features */}
        <section id="features">
          <h2 className="text-2xl font-bold">Everything you need to grow</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-zinc-600">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How */}
        <section id="how">
          <h2 className="text-2xl font-bold">Live in an afternoon</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-2xl bg-zinc-50 p-5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0d7a5f] text-sm font-bold text-white">{s.n}</span>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-zinc-600">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* WhatsApp */}
        <section className="rounded-3xl bg-[#0d7a5f] p-6 text-white sm:p-8">
          <h2 className="text-2xl font-bold">WhatsApp is your front desk</h2>
          <p className="mt-2 max-w-2xl text-emerald-50">Enquiries from WhatsApp become bookings in one tap. Send confirmations, day-before reminders and receipts automatically.</p>
          <Link href="/register" className="mt-4 inline-block rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-[#0d7a5f]">Connect WhatsApp free</Link>
        </section>

        {/* Portal + cleaner */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl border border-zinc-100 p-6">
            <h2 className="text-xl font-bold">Customer portal</h2>
            <p className="mt-2 text-sm text-zinc-600">Customers rebook, pay invoices and rate visits from a simple link — no app to install.</p>
          </div>
          <div className="rounded-3xl border border-zinc-100 p-6">
            <h2 className="text-xl font-bold">Cleaner app view</h2>
            <p className="mt-2 text-sm text-zinc-600">Each cleaner sees today&apos;s jobs, addresses and notes on their phone, and marks work done.</p>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing">
          <h2 className="text-2xl font-bold">Simple pricing in TZS</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {[
              { name: "Starter", price: "TZS 25,000/mo", text: "1 branch, 5 staff, 100 bookings/mo. Perfect for getting started." },
              { name: "Growth", price: "TZS 60,000/mo", text: "3 branches, WhatsApp automation, M-Pesa invoicing. Most popular." },
              { name: "Pro", price: "TZS 120,000/mo", text: "Unlimited branches, reports, priority support. For scaling teams." },
            ].map((p) => (
              <div key={p.name} className="rounded-2xl border border-zinc-100 p-5 shadow-sm">
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-1 text-lg font-bold text-[#0d7a5f]">{p.price}</p>
                <p className="mt-2 text-sm text-zinc-600">{p.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Testimonials */}
        <section>
          <h2 className="text-2xl font-bold">Loved by cleaning teams</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <blockquote className="rounded-2xl bg-zinc-50 p-5 text-sm text-zinc-700">&ldquo;We stopped losing bookings in WhatsApp. Every job is on the calendar now.&rdquo; — Amina, Dar es Salaam</blockquote>
            <blockquote className="rounded-2xl bg-zinc-50 p-5 text-sm text-zinc-700">&ldquo;M-Pesa invoices get us paid in days, not weeks.&rdquo; — Brian, Arusha</blockquote>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq">
          <h2 className="text-2xl font-bold">FAQ</h2>
          <div className="mt-4 divide-y divide-zinc-100 rounded-2xl border border-zinc-100">
            {FAQS.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="cursor-pointer font-medium">{f.q}</summary>
                <p className="mt-2 text-sm text-zinc-600">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-100 py-6 text-center text-sm text-zinc-500">
        Safi · Cleaning business platform · Dar es Salaam, Tanzania
      </footer>
    </div>
  );
}
