import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { InstallCommand } from '@/components/install-command';
import { SiteFooter } from '@/components/site-footer';
import { HeroCode } from '@/components/hero-code';

export default function Home() {
  return <HomeLayout {...baseOptions()}>
    <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> HYPERLIQUID · AGENT CLI</p>
          <h1>Trading tools.<br /><span>For your agent.</span></h1>
          <p className="hero-description">JSON commands, a persistent signing runner, Privy managed agents, and Relay funding. Keep master custody in your wallet and give your agent the tools to trade.</p>
          <div className="hero-actions"><Link href="/docs/quickstart" className="btn">Get started <ArrowRight aria-hidden="true" /></Link><Link href="/docs/commands" className="btn btn--secondary">Command reference <ArrowRight aria-hidden="true" /></Link></div>
          <InstallCommand />
        </div>
        <HeroCode />
      </section>
      <section className="principles" aria-label="CLI features">
        <div><span className="feature-number">01</span><h2>JSON in. JSON out.</h2><p>Discover input and output schemas for every command. Handle stable error codes and exact decimal strings.</p></div>
        <div><span className="feature-number">02</span><h2>External master custody.</h2><p>A separate managed agent signs trades. Master approvals and funding signatures stay in the user's wallet.</p></div>
        <div><span className="feature-number">03</span><h2>Track every intent.</h2><p>Replay events and inspect a hash-chained audit connecting intent, decisions, signature digests, and fills.</p></div>
      </section>
      <section className="start-grid">
        <div><p className="eyebrow">FROM ONBOARDING TO OPERATIONS</p><h2>Build a trading workflow.</h2><p>Start with a test account, set risk limits, and monitor your runner.</p></div>
        <div className="guide-links">{[
          ['/docs/quickstart', '01', 'Quickstart', 'Initialize, fund, confirm settlement, and run.'],
          ['/docs/config', '02', 'Configuration', 'State, environment variables, limits, and builder fees.'],
          ['/docs/custody', '03', 'Custody and security', 'Understand the signing and policy boundaries.'],
          ['/docs/skill', '04', 'Agent skill', 'Install the packaged guide for Codex or Claude Code.'],
        ].map(([href, number, title, description]) => <Link href={href} key={href}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div><ArrowRight aria-hidden="true" /></Link>)}</div>
      </section>
    </main>
    <SiteFooter />
  </HomeLayout>;
}
