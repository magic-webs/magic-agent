"use client";

import { Bar, Bubble, Phone, Row, Stage, Text, Thread, type Act } from "@/components/landing/stageshow/kit";
import { Msg, WhatsAppHeader } from "@/components/landing/stageshow/whatsapp";
import { useSiteTheme } from "@/components/landing/stageshow/site";
import "./scenes.css";
import "./answers.css";

type S = { typing: boolean; found: boolean; answer: boolean };

const initial: S = { typing: false, found: false, answer: false };
const poster: S = { typing: false, found: true, answer: true };

const GREET = "Hi Riya! Welcome to Crumb & Co. What can we bake for you today?";
const ASK = "Hi! Do you have an eggless chocolate truffle cake, 1 kg?";
const ANSWER = "Yes! Our eggless chocolate truffle is ₹1,150 for 1 kg. Shall we pipe a message on top?";

async function script(a: Act<S>) {
  await a.wait(900);
  await a.set({ typing: true });
  await a.wait(900);
  a.mark("find");
  await a.set({ found: true });
  await a.wait(1200);
  a.mark("answer");
  await a.set({ typing: false, answer: true });
  await a.wait(2600);
  a.mark("done");
}

const ABOVE = [
  { name: 76, sub: 58, thumb: "#efd9c2" },
  { name: 58, sub: 66, thumb: "#f3d2d5" },
  { name: 84, sub: 52, thumb: "#e6dcc9" },
  { name: 62, sub: 60, thumb: "#e9d3c6" },
];
const BELOW = [
  { name: 66, sub: 56, thumb: "#dfe7d2" },
  { name: 72, sub: 62, thumb: "#f0e2c8" },
];

function Filler({ name, sub, thumb }: { name: number; sub: number; thumb: string }) {
  return (
    <Row
      pad={8}
      lead={<span className="ans-thumb" style={{ background: thumb }} />}
      title={<Bar w={name} h={7} tone={3} />}
      subtitle={<Bar w={sub} h={6} tone={2} />}
    />
  );
}

function Match({ found, compact }: { found: boolean; compact: boolean }) {
  return (
    <div className="ans-match" data-on={found || undefined}>
      <Row
        pad={8}
        lead={<span className="ans-thumb ans-thumb--truffle" />}
        title={<Text className="ans-row__name">Truffle cake</Text>}
        subtitle={
          <span className="ans-row__sub">
            <span className="ans-row__price">₹1,150</span> · {compact ? "1 kg" : "eggless, 1 kg"}
          </span>
        }
      />
    </div>
  );
}

function Catalogue({ found, compact }: { found: boolean; compact: boolean }) {
  return (
    <div className="ans-card">
      <div className="ans-card__head">
        <Text className="ans-card__title">Catalogue</Text>
      </div>
      <div className="ans-card__rows">
        {!compact && ABOVE.map((row, i) => <Filler key={i} {...row} />)}
        <Match found={found} compact={compact} />
        {!compact && BELOW.map((row, i) => <Filler key={i} {...row} />)}
      </div>
    </div>
  );
}

export function AnswersScene() {
  const theme = useSiteTheme();
  return (
    <Stage<S>
      width={544}
      height={372}
      compact={{ below: 500, width: 358, height: 460 }}
      initial={initial}
      poster={poster}
      script={script}
      play="once"
      theme={theme}
      className="scene ans"
    >
      {(s, _rect, layout) => (
        <>
          <Catalogue found={s.found} compact={layout === "compact"} />
          <Phone dark={theme === "dark"} width={layout === "wide" ? 300 : 280} className="wa-phone ans-phone">
            <WhatsAppHeader name="Crumb & Co." />
            <Thread className="wa-thread">
              <span className="wa-day">Today</span>
              {layout === "wide" && (
                <Bubble tail={false} from="me">
                  <Msg text="Hi" time="10:40" read />
                </Bubble>
              )}
              <Bubble tail={false} from="them">
                <Msg text={GREET} time="10:40" />
              </Bubble>
              <Bubble tail={false} from="me">
                <Msg text={ASK} time="10:41" read />
              </Bubble>
              {(s.typing || s.answer) && (
                <Bubble tail={false} from="them" typing={s.typing}>
                  <Msg text={ANSWER} time="10:41" />
                </Bubble>
              )}
            </Thread>
          </Phone>
        </>
      )}
    </Stage>
  );
}
