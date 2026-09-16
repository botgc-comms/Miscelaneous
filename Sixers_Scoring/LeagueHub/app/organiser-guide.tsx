'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  Dialog,
  DialogPortal,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useSidebar } from '@/components/ui/sidebar';

type Destination =
  | 'My club'
  | 'Our availability'
  | 'Fixtures'
  | 'Clubs'
  | 'Teams & players';
const GuideContext = createContext<(target: Destination) => void>(() => {});
export const useOrganiserGuide = () => useContext(GuideContext);
const SelectionContext = createContext({
  clubId: '',
  teamId: '',
  setClubId: (_id: string) => {},
  setTeamId: (_id: string) => {},
});
export const useOrganiserSelection = () => useContext(SelectionContext);

export function OrganiserGuideProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Destination | null>(null);
  const [clubId, setClubId] = useState(''),
    [teamId, setTeamId] = useState('');
  return (
    <GuideContext.Provider value={setTarget}>
      <SelectionContext.Provider
        value={{ clubId, teamId, setClubId, setTeamId }}
      >
        {children}
        {target && (
          <NavigationGuide
            key={target}
            target={target}
            close={() => setTarget(null)}
            next={(target) => setTarget(target)}
          />
        )}
      </SelectionContext.Provider>
    </GuideContext.Provider>
  );
}

function NavigationGuide({
  target,
  close,
  next,
}: {
  target: Destination;
  close: () => void;
  next: (target: Destination) => void;
}) {
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  const [box, setBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    vw: number;
    vh: number;
  } | null>(null);
  useEffect(() => {
    setBox(null);
    if (isMobile) setOpenMobile(true);
    else setOpen(true);
    let frame = 0;
    let ready = false;
    const measure = () => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>('[data-organiser-nav]'),
      );
      const node = nodes.find(
        (n) =>
          n.dataset.organiserNav === target &&
          n.getBoundingClientRect().width > 0 &&
          n.getBoundingClientRect().left >= 0,
      );
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setBox({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        vw: window.innerWidth,
        vh: window.innerHeight,
      });
    };
    const refresh = () => {
      if (!ready) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    // Wait for the mobile navigation drawer to finish opening before pointing.
    const timer = window.setTimeout(() => {
      ready = true;
      refresh();
    }, 250);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
    };
  }, [target, isMobile, setOpen, setOpenMobile]);
  const dismiss = () => {
    close();
    if (isMobile) setOpenMobile(false);
  };
  if (!box) return null;
  const beside = box.vw - box.x - box.width > 380;
  const width = Math.min(340, box.vw - 32);
  const left = beside
    ? box.x + box.width + 32
    : Math.max(16, Math.min(box.x, box.vw - width - 16));
  const top = Math.max(
    16,
    Math.min(beside ? box.y : box.y + box.height + 64, box.vh - 245),
  );
  const endX = beside ? box.x + box.width + 7 : box.x + box.width / 2;
  const endY = beside ? box.y + box.height / 2 : box.y + box.height + 7;
  const startX = beside ? left - 7 : left + width / 2;
  const startY = beside ? top + 44 : top - 8;
  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogPortal>
        <DialogPrimitive.Backdrop className="organiser-guide-backdrop" />
        <svg
          className="organiser-guide-spotlight"
          width={box.vw}
          height={box.vh}
          aria-hidden="true"
          onClick={dismiss}
        >
          <defs>
            <mask id="organiser-guide-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={box.x - 5}
                y={box.y - 5}
                width={box.width + 10}
                height={box.height + 10}
                rx="10"
                fill="black"
              />
            </mask>
            <marker
              id="organiser-guide-arrow"
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="5"
              orient="auto"
            >
              <path
                d="M 1 1 L 8 5 L 1 9"
                fill="none"
                stroke="white"
                strokeWidth="2"
              />
            </marker>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(9, 27, 24, 0.72)"
            mask="url(#organiser-guide-mask)"
          />
          <rect
            x={box.x - 5}
            y={box.y - 5}
            width={box.width + 10}
            height={box.height + 10}
            rx="10"
            fill="none"
            stroke="#d5ef84"
            strokeWidth="3"
          />
          <path
            d={`M ${startX} ${startY} Q ${beside ? startX - 18 : startX} ${beside ? endY : startY - 28} ${endX} ${endY}`}
            fill="none"
            stroke="white"
            strokeWidth="3"
            markerEnd="url(#organiser-guide-arrow)"
          />
        </svg>
        <DialogPrimitive.Popup
          className="organiser-guide-card"
          style={{ left, top, width }}
        >
          <DialogTitle>
            {target === 'My club'
              ? 'Your club details live here'
              : target === 'Our availability'
                ? 'Your hosting availability lives here'
                : target === 'Fixtures'
                  ? 'Your season fixtures are confirmed'
                  : target === 'Clubs'
                    ? 'Club details stay editable'
                    : 'Keep managing your teams and players'}
          </DialogTitle>
          <DialogDescription>
            {target === 'My club'
              ? 'Use My club whenever you need to update your address, contact details or visitor information.'
              : target === 'Our availability'
                ? 'Your hosting plans are shared. Use Our availability to change your possible dates or hosting plans at any time.'
                : target === 'Fixtures'
                  ? 'Come back to Fixtures to change a date, venue or match details. Families receive an in-app update when a confirmed fixture changes.'
                  : target === 'Clubs'
                    ? 'Use Clubs to update venue information and club contacts whenever arrangements change.'
                    : 'Use Teams & players for registrations and team allocations throughout the season. Confirming fixtures does not close registration.'}
          </DialogDescription>
          {isMobile && <p>Open the menu at the top left to find this again.</p>}
          <button
            className="btn primary"
            onClick={() =>
              target === 'Fixtures'
                ? next('Clubs')
                : target === 'Clubs'
                  ? next('Teams & players')
                  : dismiss()
            }
          >
            {target === 'Fixtures' || target === 'Clubs' ? 'Next' : 'Got it'}
          </button>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
