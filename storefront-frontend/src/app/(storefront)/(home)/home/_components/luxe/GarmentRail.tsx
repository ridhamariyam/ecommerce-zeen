'use client';

import Image from 'next/image';
import Link from 'next/link';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';

import { useCart } from '@/context/CartContext';
import { catalogueApi } from '@/lib/api/catalogue';
import { optionValueLabel, orderSizes } from '@/lib/catalogue/size';
import { STOREFRONT_CURRENCY } from '@/lib/currency';
import { formatMoney, formatPriceRange } from '@/lib/format';
import { mediaUrl } from '@/lib/media';
import type { ProductStorefront, ProductSummaryStorefront } from '@/types/catalogue';

import styles from './GarmentRail.module.css';
import { CloseIcon } from './Icons';

type RailProduct = { product: ProductSummaryStorefront; image: string };

const MAX_PRODUCTS = 10;
/** A short catalogue repeats its pieces so the rail still reads as a full rail. */
const MIN_HANGERS = 8;
/** Cut-outs of each garment on its hanger, shot from three sides. */
const RAIL_GARMENTS = ['olive', 'block-print'] as const;

function productHref(product: { id: string; slug?: string }) {
  return product.slug ? `/products/${encodeURIComponent(product.slug)}` : `/single-product/${product.id}`;
}

/**
 * The collection on a clothes rail: pieces hang side-on facing the active one,
 * which turns to the front while its neighbours slide apart.
 * Choosing a piece opens `GarmentView`.
 */
export function GarmentRail({ products }: { products: RailProduct[] }) {
  const pieces = products.slice(0, MAX_PRODUCTS);
  const hangers = useMemo(() => {
    if (pieces.length === 0) return [];
    const count = Math.max(pieces.length, MIN_HANGERS);
    return Array.from({ length: count }, (_, i) => ({ ...pieces[i % pieces.length], index: i % pieces.length, repeat: i >= pieces.length }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  const [active, setActive] = useState(() => Math.floor(hangers.length / 2));
  const [open, setOpen] = useState<number | null>(null);

  if (hangers.length === 0) return null;

  const current = hangers[Math.min(active, hangers.length - 1)];

  return (
    <section className={styles.section} aria-labelledby="garment-rail-title">
      <h2 id="garment-rail-title" className={styles.eyebrow}>
        <span>New collection</span>
        <span className={styles.eyebrowSoft}>Timeless ethnic wear</span>
      </h2>

      <div className={styles.scroller}>
        <div className={styles.track} style={{ '--count': hangers.length } as CSSProperties}>
          <span className={styles.bar} aria-hidden="true" />
          {hangers.map(({ product, index, repeat }, i) => {
            const price = formatMoney(product.price_from, STOREFRONT_CURRENCY);
            const tag = price || (product.in_stock ? null : 'Sold out');
            const side = i === active ? 'front' : i < active ? 'left' : 'right';
            const garment = RAIL_GARMENTS[index % RAIL_GARMENTS.length];
            return (
              <button
                key={`${product.id}-${i}`}
                type="button"
                className={styles.hanger}
                data-side={side}
                aria-label={repeat ? undefined : `${product.name}${tag ? `, ${tag}` : ''}. View details`}
                aria-hidden={repeat || undefined}
                tabIndex={repeat ? -1 : undefined}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setOpen(index)}
              >
                {tag && <span className={styles.tag}>{tag}</span>}
                <span className={styles.card}>
                  {(['front', 'left', 'right'] as const).map(pose => (
                    <Image
                      key={pose}
                      src={`/home/rail/${garment}-${pose}.webp`}
                      alt=""
                      fill
                      sizes="(max-width: 767px) 220px, 340px"
                      className={styles.pose}
                      data-pose={pose}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className={styles.name} aria-live="polite">{current.product.name}</p>
      <Link href="/products" className={styles.shop}>Shop the Collection</Link>

      {open !== null && (
        <GarmentView
          key={pieces[open].product.id}
          piece={pieces[open]}
          position={open + 1}
          total={pieces.length}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

/**
 * One piece, full size, ready to buy. Sizes, stock and price are fetched fresh
 * from the catalogue when it opens, and nothing is pre-selected unless the
 * piece offers a single choice. A native dialog gives the focus trap, Escape
 * and focus return.
 */
function GarmentView({ piece, position, total, onClose }: { piece: RailProduct; position: number; total: number; onClose: () => void }) {
  const { product: summary, image } = piece;
  const { addToCart, openCartDrawer, pending } = useCart();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [product, setProduct] = useState<ProductStorefront | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [photo, setPhoto] = useState(0);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = overflow;
      dialog?.close();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    catalogueApi
      .getProduct(summary.id)
      .then(result => {
        if (!cancelled) setProduct(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [summary.id]);

  const options = product?.options ?? [];
  const choices = { ...Object.fromEntries(options.filter(o => o.values.length === 1).map(o => [o.name, o.values[0]])), ...picked };
  const variant = product?.variants.find(v => options.every(o => v.options[o.name] === choices[o.name]));
  const missing = options.find(o => !choices[o.name]);
  const photos = product?.images.length ? product.images.map(i => mediaUrl(i.url) ?? i.url) : [image];
  const price = variant ? formatMoney(variant.price, STOREFRONT_CURRENCY) : formatPriceRange(summary.price_from, summary.price_to, STOREFRONT_CURRENCY);

  function pick(name: string, value: string) {
    setPicked(current => ({ ...current, [name]: value }));
    setAdded(false);
  }

  async function add() {
    if (!variant) return;
    const failure = await addToCart(variant.id, 1, { openDrawer: false });
    if (failure) toast.error(failure);
    else setAdded(true);
  }

  function viewCart() {
    onClose();
    openCartDrawer();
  }

  let action = 'Add to cart';
  if (added) action = 'Added to cart';
  else if (product && !product.in_stock) action = 'Sold out';
  else if (variant && !variant.in_stock) action = 'Sold out';
  else if (missing) action = `Select ${missing.name.toLowerCase()}`;

  return (
    <dialog
      ref={dialogRef}
      className={styles.view}
      aria-labelledby="garment-view-title"
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button type="button" className={styles.close} onClick={onClose}>
        Close <CloseIcon size={16} />
      </button>

      <div className={styles.viewBody}>
        <div className={styles.viewPhoto} key={photos[photo]}>
          <Image src={photos[photo] ?? image} alt={product?.images[photo]?.alt_text ?? summary.name} fill sizes="(max-width: 767px) 100vw, 50vw" priority />
        </div>

        <div className={styles.details}>
          <p className={styles.count}>{String(position).padStart(2, '0')} / {String(total).padStart(2, '0')}</p>
          <h3 id="garment-view-title" className={styles.title}>{summary.name}</h3>
          {price && <p className={styles.price}>{price}</p>}

          {photos.length > 1 && (
            <div className={styles.views} aria-label="Photos">
              {photos.map((url, i) => (
                <button key={url} type="button" className={styles.viewTab} aria-pressed={i === photo} onClick={() => setPhoto(i)}>
                  View {i + 1}
                </button>
              ))}
            </div>
          )}

          {options.map(option => (
            <fieldset key={option.name} className={styles.option}>
              <legend>{option.name}</legend>
              {(option.name.toLowerCase() === 'size' ? orderSizes(option.values) : option.values).map(value => (
                <button key={value} type="button" className={styles.pill} aria-pressed={choices[option.name] === value} onClick={() => pick(option.name, value)}>
                  {optionValueLabel(option.name, value)}
                </button>
              ))}
            </fieldset>
          ))}

          {loadError && <p className={styles.notice}>Sizes could not be loaded here. You can still choose yours in the shop.</p>}

          <button
            type="button"
            className={styles.add}
            data-added={added || undefined}
            disabled={!variant?.in_stock || added || pending}
            onClick={add}
          >
            {action}
          </button>

          {added && (
            <button type="button" className={styles.viewCart} onClick={viewCart}>
              View cart <span aria-hidden="true">&rarr;</span>
            </button>
          )}

          <div className={styles.foot}>
            <span>{summary.name}</span>
            <Link href={productHref(summary)}>View in the shop</Link>
          </div>
        </div>
      </div>
    </dialog>
  );
}
