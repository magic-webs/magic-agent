"use client";

import { Avatar, Badge, Bar, Bubble, Button, Phone, Roll, Row, Stage, Text, Thread, Window, type Act } from "@/components/landing/stageshow/kit";
import { Msg, WhatsAppHeader } from "@/components/landing/stageshow/whatsapp";
import { useSiteTheme } from "@/components/landing/stageshow/site";
import "./scenes.css";
import "./collects.css";

type S = {
  askTyping: boolean;
  ask: boolean;
  reply: boolean;
  print: boolean;
  date: boolean;
  answerTyping: boolean;
  answer: boolean;
  lead: boolean;
  ready: boolean;
};

const initial: S = { askTyping: false, ask: false, reply: false, print: false, date: false, answerTyping: false, answer: false, lead: false, ready: false };
const poster: S = { askTyping: false, ask: true, reply: true, print: true, date: true, answerTyping: false, answer: true, lead: true, ready: true };

const MSG = {
  greet: "Hi Priya, welcome to Inkwell Prints. What can we print for you today?",
  first: "Hi! Need 500 printed tote bags for an event",
  ask: "Happy to help. How many print colours, and one side or both?",
  reply: "2 colours, one side. Need them by 28 Nov",
  answer: "500 bags ship in 7 working days, so 28 Nov works. Your quote is on its way.",
};

async function script(a: Act<S>) {
  await a.wait(900);
  await a.set({ askTyping: true });
  await a.wait(1200);
  a.mark("ask");
  await a.set({ askTyping: false, ask: true });
  await a.wait(1600);
  a.mark("reply");
  await a.set({ reply: true });
  await a.wait(650);
  a.mark("fill");
  await a.set({ print: true });
  await a.wait(380);
  await a.set({ date: true });
  await a.wait(1100);
  await a.set({ answerTyping: true });
  await a.wait(1300);
  a.mark("answer");
  await a.set({ answerTyping: false, answer: true });
  await a.wait(700);
  await a.set({ lead: true });
  await a.wait(600);
  a.mark("ready");
  await a.set({ ready: true });
  await a.wait(2800);
  a.mark("done");
}

function Field({ label, value, on }: { label: string; value: string; on: boolean }) {
  return (
    <div className="co-field" data-on={on || undefined}>
      <span className="co-field__label">{label}</span>
      <span className="co-field__value">
        <Roll>{on ? value : "—"}</Roll>
      </span>
    </div>
  );
}

function Enquiry({ s, compact }: { s: S; compact: boolean }) {
  return (
    <section className="co-enquiry">
      <div className="co-enquiry__head">
        <Avatar name="Priya Sharma" size={32} />
        <span className="co-enquiry__who">
          <Text className="co-enquiry__name">Priya Sharma</Text>
          <Badge tone={s.ready ? "success" : "warning"} className="co-status">
            <Roll>{s.ready ? "Ready to quote" : "Collecting"}</Roll>
          </Badge>
        </span>
      </div>
      <div className="co-fields">
        <Field label="Product" value="Tote bags" on />
        <Field label="Quantity" value="500" on />
        <Field label="Print" value="2 colours, one side" on={s.print} />
        <Field label="Needed by" value="28 Nov" on={s.date} />
        <Field label="Lead time" value="7 working days" on={s.lead} />
      </div>
      {!compact && (
        <div className="co-enquiry__foot">
          <Button variant={s.ready ? "primary" : "secondary"}>Send quote</Button>
        </div>
      )}
    </section>
  );
}

const LIST = [
  { name: 70, item: 96 },
  { name: 58, item: 112 },
  { name: 82, item: 84 },
  { name: 64, item: 104 },
  { name: 74, item: 90 },
];

function WhatsApp({ s }: { s: S }) {
  return (
    <>
      <WhatsAppHeader name="Inkwell Prints" />
      <Thread className="wa-thread">
        <Bubble tail={false} from="me">
          <Msg text="Hi" time="10:40" read />
        </Bubble>
        <Bubble tail={false} from="them">
          <Msg text={MSG.greet} time="10:40" />
        </Bubble>
        <Bubble tail={false} from="me">
          <Msg text={MSG.first} time="10:41" read />
        </Bubble>
        {(s.askTyping || s.ask) && (
          <Bubble tail={false} from="them" typing={s.askTyping}>
            <Msg text={MSG.ask} time="10:41" />
          </Bubble>
        )}
        {s.reply && (
          <Bubble tail={false} from="me">
            <Msg text={MSG.reply} time="10:42" read />
          </Bubble>
        )}
        {(s.answerTyping || s.answer) && (
          <Bubble tail={false} from="them" typing={s.answerTyping}>
            <Msg text={MSG.answer} time="10:42" />
          </Bubble>
        )}
      </Thread>
    </>
  );
}

export function CollectsScene() {
  const theme = useSiteTheme();
  return (
    <Stage<S>
      width={544}
      height={400}
      compact={{ below: 500, width: 358, height: 560 }}
      initial={initial}
      poster={poster}
      script={script}
      play="once"
      theme={theme}
      className="scene co"
    >
      {(s, _rect, layout) => (
        <>
          {layout === "wide" && (
            <Window className="co-window" title="Enquiries">
              <div className="co-app">
                <div className="co-list">
                  <Row
                    selected
                    lead={<Avatar name="Priya Sharma" size={28} />}
                    title={<Text className="co-row__name">Priya Sharma</Text>}
                    subtitle={<Text className="co-row__item">Tote bags</Text>}
                  />
                  {LIST.map((r, i) => (
                    <Row key={i} lead={<Avatar size={28} plain />} title={<Bar w={r.name} h={7} tone={3} />} subtitle={<Bar w={r.item} h={6} tone={2} />} />
                  ))}
                </div>
                <Enquiry s={s} compact={false} />
              </div>
            </Window>
          )}

          <Phone dark={theme === "dark"} width={layout === "wide" ? 240 : 280} className="wa-phone co-phone">
            <WhatsApp s={s} />
          </Phone>

          {layout === "compact" && (
            <div className="co-card">
              <Enquiry s={s} compact />
            </div>
          )}
        </>
      )}
    </Stage>
  );
}
