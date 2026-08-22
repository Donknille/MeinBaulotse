import Link from 'next/link';

export default function NichtGefunden() {
  return (
    <main id="inhalt" className="mx-auto w-full max-w-xl flex-1 px-4 py-16">
      <h1 className="text-2xl font-semibold">Diese Seite gibt es hier nicht</h1>
      <p className="mt-3 max-w-[62ch] leading-relaxed text-muted-foreground">
        Vermutlich ist der Verweis veraltet. Von der Startseite aus finden Sie das Beispielprojekt
        wieder.
      </p>
      <Link href="/" className="mt-6 inline-flex text-primary hover:underline">
        Zur Startseite
      </Link>
    </main>
  );
}
