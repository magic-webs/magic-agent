"use client";

import { Avatar, Badge, Count, Fly, Roll, Slot, Stage, Text, Window, type Act, type Rect } from "@/components/landing/stageshow/kit";
import { useSiteTheme } from "@/components/landing/stageshow/site";
import { ChannelMark, type ChannelKind } from "@/components/channel-mark";
import "./scenes.css";
import "./pipeline.css";

type Chip = "quiet" | "sent" | "replied";
type S = { chip: Chip; fly: null | { from: Rect; to: Rect; go: boolean }; moved: boolean };

const initial: S = { chip: "quiet", fly: null, moved: false };
const poster: S = { chip: "replied", fly: null, moved: true };

const CARD = 84;
const GAP = 8;

async function script(a: Act<S>) {
  await a.wait(1000);
  a.mark("sent");
  await a.set({ chip: "sent" });
  await a.wait(1700);
  a.mark("replied");
  await a.set({ chip: "replied" });
  await a.wait(1200);
  const from = a.rect("rohan", { layout: true });
  const list = a.rect("ready-list", { layout: true });
  const to = { x: list.x, y: list.y, width: from.width, height: from.height };
  await a.set({ fly: { from, to, go: false } });
  await a.wait(40);
  a.mark("fly");
  await a.set((s) => ({ fly: s.fly && { ...s.fly, go: true } }));
  await a.wait(850);
  await a.set({ fly: null, moved: true });
  await a.wait(2800);
  a.mark("done");
}

const CHIP: Record<Chip, { tone: "neutral" | "accent" | "success"; label: string }> = {
  quiet: { tone: "neutral", label: "Quiet · 2d" },
  sent: { tone: "accent", label: "Followed up" },
  replied: { tone: "success", label: "Replied" },
};

function Lead({ chip }: { chip: Chip }) {
  return (
    <div className="pl-card pl-card--lead">
      <Avatar name="Rohan Kulkarni" size={22} />
      <div className="pl-card__body">
        <div className="pl-card__top">
          <Text className="pl-card__name">Rohan K.</Text>
          <ChannelMark type="whatsapp" size={14} />
        </div>
        <Text className="pl-card__item">Visiting cards</Text>
        <Badge tone={CHIP[chip].tone} className="pl-chip">
          <Roll>{CHIP[chip].label}</Roll>
        </Badge>
      </div>
    </div>
  );
}

type Person = { name: string; item: string; channel: ChannelKind };

function Other({ name, item, channel }: Person) {
  return (
    <div className="pl-card">
      <Avatar name={name} size={22} />
      <div className="pl-card__body">
        <div className="pl-card__top">
          <Text className="pl-card__name">{name}</Text>
          <ChannelMark type={channel} size={14} />
        </div>
        <Text className="pl-card__item">{item}</Text>
      </div>
    </div>
  );
}

const PEOPLE: Record<string, Person> = {
  meera: { name: "Meera I.", item: "Wedding cards", channel: "instagram" },
  arjun: { name: "Arjun R.", item: "Flex banners", channel: "whatsapp" },
  sana: { name: "Sana M.", item: "Menu cards", channel: "web" },
  dev: { name: "Dev P.", item: "Stickers", channel: "whatsapp" },
  kavya: { name: "Kavya S.", item: "Letterheads", channel: "instagram" },
  imran: { name: "Imran K.", item: "Tote bags", channel: "whatsapp" },
  neha: { name: "Neha G.", item: "Brochures", channel: "web" },
  tara: { name: "Tara B.", item: "Calendars · 150", channel: "whatsapp" },
  omar: { name: "Omar F.", item: "Standees", channel: "instagram" },
  farah: { name: "Farah N.", item: "Invitations", channel: "web" },
};

function Column({ title, count, children, target }: { title: string; count: number; children: React.ReactNode; target?: string }) {
  return (
    <div className="pl-col">
      <div className="pl-col__head">
        <Text className="pl-col__title">{title}</Text>
        <Count value={count} className="pl-col__count" />
      </div>
      <div className="pl-col__list" data-target={target}>
        {children}
      </div>
    </div>
  );
}

export function PipelineScene() {
  const theme = useSiteTheme();
  return (
    <Stage<S>
      width={544}
      height={372}
      compact={{ below: 500, width: 358, height: 286 }}
      initial={initial}
      poster={poster}
      script={script}
      play="once"
      theme={theme}
      className="scene pl"
    >
      {(s, _rect, layout) => {
        const flying = !!s.fly?.go;
        return (
          <>
            <Window className="pl-window" title="Leads">
              <div className="pl-board">
                {layout === "wide" && (
                  <Column title="New" count={4}>
                    <Other {...PEOPLE.meera} />
                    <Other {...PEOPLE.arjun} />
                    <Other {...PEOPLE.sana} />
                    <Other {...PEOPLE.tara} />
                  </Column>
                )}
                <Column title="Gone quiet" count={s.moved || flying ? 3 : 4}>
                  <Slot open={!s.moved && !flying} height={CARD} gap={GAP}>
                    {!s.moved && !flying && (
                      <div data-target="rohan">
                        <Lead chip={s.chip} />
                      </div>
                    )}
                  </Slot>
                  <Other {...PEOPLE.dev} />
                  <Other {...PEOPLE.kavya} />
                  <Other {...PEOPLE.omar} />
                </Column>
                <Column title="Ready to quote" count={s.moved ? 6 : 5} target="ready-list">
                  <Slot open={flying || s.moved} height={CARD} gap={GAP}>
                    {s.moved && <Lead chip={s.chip} />}
                  </Slot>
                  <Other {...PEOPLE.imran} />
                  <Other {...PEOPLE.neha} />
                  <Other {...PEOPLE.farah} />
                </Column>
              </div>
            </Window>
            {s.fly && (
              <Fly from={s.fly.from} to={s.fly.to} go={s.fly.go} duration={800}>
                <Lead chip={s.chip} />
              </Fly>
            )}
          </>
        );
      }}
    </Stage>
  );
}
