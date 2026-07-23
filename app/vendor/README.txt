Vendored Bibliotheken
=====================

Der Container hat kein Internet und soll auch keins brauchen. Fremdbibliotheken
liegen deshalb als fertige Datei hier und werden in index.html direkt eingebunden
— kein CDN, kein Build-Schritt, kein npm im Frontend.

jspdf.inline.js
    jsPDF (MIT). Erzeugt die Stockkarten- und Bestandsbuch-PDFs.
    Zugriff über window.jspdf.jsPDF.

    Eigenheit beim Testen: jsPDF legt seine Methoden (text, addPage, …) als
    EIGENE Eigenschaften der Instanz an — nicht am Prototyp und nicht unter
    jsPDF.API. Wer die Ausgabe mitschneiden will, muss die Instanz umhüllen
    (z. B. IM.export.pdfBasis.neuesDokument überschreiben), nicht die Klasse.
    Ein Patch an jsPDF.API zerstört die Klasse für den Rest der Sitzung.
