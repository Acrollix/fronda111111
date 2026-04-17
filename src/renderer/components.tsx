import { clsx } from "clsx";
import { createPortal } from "react-dom";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode
} from "react";

const scrollMemory = new Map<string, number>();

const DEFAULT_FIELD_COPY: Record<string, { help?: string; hint?: string }> = {
  "Ник": {
    help: "Основной ник участника. По нему удобно искать человека и быстро связывать его с релизами."
  },
  "Отображаемое имя": {
    help: "Главное имя карточки. Оно показывается в реестре, обзоре и большинстве внутренних списков."
  },
  "Реальное имя": {
    help: "Настоящее имя хранится отдельно от ника и отображаемого имени. Заполняйте его только там, где это действительно нужно команде."
  },
  "Статус": {
    help: "Показывает текущее состояние записи: активна ли она, находится в резерве, архиве или в другом рабочем статусе."
  },
  "Имя в посте": {
    help: "Это имя автоматически берется из ника участника. Если подпись в посте должна быть другой, измените ник в основной карточке."
  },
  "Подпись в посте": {
    help: "Это имя автоматически берется из ника участника. Если подпись в посте должна быть другой, измените ник в основной карточке."
  },
  "Произношение ника": {
    help: "Помогает команде правильно читать ник в работе и на созвонах. Например: Ника-нор, Широ, Ая."
  },
  "MAX": {
    help: "Основной контакт в MAX, если команда использует его для быстрой связи."
  },
  "Телефон": {
    help: "Номер для экстренной или прямой связи, если его можно хранить в карточке."
  },
  "Telegram": {
    help: "Основной ник, ссылка или номер для связи в Telegram."
  },
  "Связь VK": {
    help: "Контакт для связи через VK. При необходимости можно использовать короткий адрес или полную ссылку."
  },
  "Дополнительные контакты": {
    help: "Добавляйте по одной строке: сайт, Discord, почта, резервный мессенджер или другой способ связи."
  },
  "Заинтересованность": {
    help: "Показывает отношение человека к отделу: он уже участвует, может подключиться, делает это по желанию или не хочет работать в этом направлении."
  },
  "Разделитель поста": {
    help: "Разделительная линия между блоками в готовом посте. Используйте вариант, который лучше подходит текущему формату релиза."
  },
  "Рост в озвучке": {
    help: "Показывает, в каком актерском направлении участник хочет расти или проходить обучение. Здесь не указываются управленческие или технические роли."
  },
  "Ссылка или путь к пробе": {
    help: "Основная ссылка или прямой путь к пробе голоса. Указывайте здесь главный источник, по которому пробу можно открыть."
  },
  "Приоритет участия": {
    help: "Определяет, стоит ли чаще предлагать участника для важных или заказных релизов."
  },
  "Упоминание VK": {
    help: "Активное упоминание человека для поста, например @mr.nikanor."
  },
  "Короткий адрес VK": {
    help: "Часть адреса после vk.com/. Если она заполнена, полная ссылка соберется автоматически."
  },
  "Полная ссылка VK": {
    help: "Готовая ссылка на страницу участника. Если указан короткий адрес, ссылка собирается автоматически."
  },
  "Роль": {
    help: "Показывает, какую задачу человек выполняет в релизе или внутри команды."
  },
  "Релиз": {
    help: "Выберите релиз, с которым нужно связать участника, роль, заметку или рабочее действие."
  },
  "Шаблон поста": {
    help: "Основной шаблон, по которому будет собираться релизный пост для этой карточки."
  }
};

export function BrandLockup({ subtitle = "Внутренняя система студии" }: { subtitle?: string }) {
  return (
    <div>
      <div className="brand-lockup">
        <div className="brand-core">
          <div className="brand-core-dot" />
        </div>
        <div>
          <div className="brand-wordmark" aria-label="FRONDA">
            <span>FR</span>
            <span className="accent">O</span>
            <span className="accent">N</span>
            <span>DA</span>
          </div>
          <div className="brand-subtitle">{subtitle}</div>
        </div>
      </div>
    </div>
  );
}

export function ScrollRegion({
  scrollKey,
  className,
  style,
  children
}: PropsWithChildren<{ scrollKey: string; className?: string; style?: CSSProperties }>) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.scrollTop = scrollMemory.get(scrollKey) ?? 0;

    const handleScroll = () => {
      scrollMemory.set(scrollKey, node.scrollTop);
    };

    node.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollMemory.set(scrollKey, node.scrollTop);
      node.removeEventListener("scroll", handleScroll);
    };
  }, [scrollKey]);

  return (
    <div ref={ref} className={clsx("workspace-column", "scroll-column", className)} style={style}>
      {children}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children
}: PropsWithChildren<{ title: string; subtitle?: string; actions?: ReactNode }>) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div className="panel-heading">
          <h2 className="panel-title">{title}</h2>
          {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Button({
  className,
  children,
  type,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={clsx("button", className)} type={type ?? "button"} {...props}>
      {children}
    </button>
  );
}

export function ActionMenu({
  label = "Еще",
  children,
  align = "end"
}: PropsWithChildren<{ label?: string; align?: "start" | "end" }>) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 320 });

  function updatePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.max(menuRef.current?.offsetWidth ?? 0, 220);
    const menuHeight = Math.max(menuRef.current?.offsetHeight ?? 0, 160);
    const viewportPadding = 12;
    const maxLeft = window.innerWidth - menuWidth - viewportPadding;
    const preferredLeft = align === "start" ? rect.left : rect.right - menuWidth;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const shouldOpenUp = availableBelow < Math.min(menuHeight, 220) && availableAbove > availableBelow;
    const preferredTop = shouldOpenUp ? rect.top - menuHeight - 8 : rect.bottom + 8;
    const maxTop = window.innerHeight - viewportPadding - Math.min(menuHeight, window.innerHeight - viewportPadding * 2);
    const top = Math.max(viewportPadding, Math.min(preferredTop, maxTop));
    setPosition({
      top,
      left: Math.max(viewportPadding, Math.min(preferredLeft, maxLeft)),
      maxHeight: Math.max(160, shouldOpenUp ? availableAbove - 8 : availableBelow - 8)
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, align, children]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleViewportChange = () => updatePosition();

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, align]);

  const wrappedChildren = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const element = child as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
    const originalOnClick = element.props.onClick;
    return cloneElement(element, {
      onClick: (event) => {
        originalOnClick?.(event);
        setOpen(false);
      }
    });
  });

  return (
    <div className={clsx("action-menu", open && "open", align === "start" ? "align-start" : undefined)}>
      <button
        ref={triggerRef}
        type="button"
        className="button secondary utility"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open
        ? createPortal(
          <div
            ref={menuRef}
            className="action-menu-list"
            style={{ top: position.top, left: position.left, maxHeight: position.maxHeight }}
          >
            {wrappedChildren}
          </div>,
          document.body
        )
        : null}
    </div>
  );
}

export function ActionMenuItem({
  className,
  children,
  type,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={clsx("action-menu-item", className)} type={type ?? "button"} {...props}>
      {children}
    </button>
  );
}

export function Chip({
  children,
  tone
}: PropsWithChildren<{ tone?: "accent" | "warning" | "danger" | "success" }>) {
  return <span className={clsx("chip", tone)}>{children}</span>;
}

export function EmptyState({
  title,
  body,
  action
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state card-shell">
      <strong>{title}</strong>
      <span className="muted">{body}</span>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  note
}: {
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <div className="stat-card card-shell">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      {note ? <div className="footer-note">{note}</div> : null}
    </div>
  );
}

export function Field({
  label,
  help,
  hint,
  children
}: PropsWithChildren<{ label: string; help?: string; hint?: string }>) {
  const defaults = DEFAULT_FIELD_COPY[label];
  const resolvedHelp = help ?? defaults?.help;
  const resolvedHint = hint ?? defaults?.hint;

  return (
    <label className="field-stack">
      <span className="field-heading">
        <span className="field-label">{label}</span>
        {resolvedHelp ? <HelpTip text={resolvedHelp} /> : null}
      </span>
      {children}
      {resolvedHint ? <span className="field-hint">{resolvedHint}</span> : null}
    </label>
  );
}

export function SearchSelect({
  value,
  options,
  onChange,
  placeholder = "Выберите значение",
  searchPlaceholder = "Начните вводить для поиска",
  emptyText = "Ничего не найдено",
  disabled
}: {
  value: string;
  options: Array<{ id: string; label: string; searchText?: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPosition, setMenuPosition] = useState<CSSProperties | null>(null);
  const selectedOption = options.find((option) => option.id === value) ?? null;
  const filteredOptions = useMemo(() => {
    const needles = normalizeSearchSelectText(query).split(/\s+/).filter(Boolean);
    if (!needles.length) {
      return options;
    }
    return options.filter((option) => {
      const haystack = normalizeSearchSelectText(`${option.label} ${option.searchText ?? ""}`);
      return needles.every((needle) => haystack.includes(needle));
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) {
      setQuery(selectedOption?.label ?? "");
    }
  }, [open, selectedOption?.label]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const viewportPadding = 10;
      const gap = 8;
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
      const spaceAbove = rect.top - viewportPadding - gap;
      const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
      const availableHeight = Math.max(160, Math.min(360, (openAbove ? spaceAbove : spaceBelow) - 4));
      setMenuPosition({
        position: "fixed",
        left: Math.max(viewportPadding, rect.left),
        top: openAbove ? Math.max(viewportPadding, rect.top - availableHeight - gap) : Math.min(window.innerHeight - viewportPadding, rect.bottom + gap),
        width: rect.width,
        ["--search-select-options-max-height" as string]: `${Math.max(96, availableHeight - 42)}px`
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options.length]);

  function commit(optionId: string) {
    onChange(optionId);
    const nextOption = options.find((option) => option.id === optionId);
    setQuery(nextOption?.label ?? "");
    setOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className={clsx("search-select", open && "open", disabled && "disabled")}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="search-select-input"
        value={open ? query : (selectedOption?.label ?? "")}
        placeholder={open ? searchPlaceholder : selectedOption ? undefined : placeholder}
        disabled={disabled}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          setQuery("");
        }}
        onChange={(event) => {
          setOpen(true);
          setQuery(event.target.value);
        }}
      />
      <button
        type="button"
        className="search-select-toggle"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (disabled) return;
          setOpen((current) => {
            const next = !current;
            if (next) {
              setQuery("");
            }
            return next;
          });
          if (!open) {
            inputRef.current?.focus();
          }
        }}
        aria-label="Открыть выбор"
      >
        ▾
      </button>
      {open && menuPosition ? createPortal((
        <div ref={menuRef} className="search-select-menu search-select-menu-portal" style={menuPosition} onPointerDown={(event) => event.stopPropagation()}>
          <div className="search-select-hint">{searchPlaceholder}</div>
          <div className="search-select-options">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={clsx("search-select-option", option.id === value && "selected")}
                onClick={() => commit(option.id)}
              >
                {option.label}
              </button>
            )) : (
              <div className="search-select-empty">{emptyText}</div>
            )}
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}

function normalizeSearchSelectText(value: string) {
  return value.toLocaleLowerCase("ru").replace(/ё/g, "е").trim();
}

export function HelpTip({
  text,
  label = "?"
}: {
  text: string;
  label?: string;
}) {
  return (
    <span className="help-tip" title={text} aria-label={text}>
      {label}
    </span>
  );
}


