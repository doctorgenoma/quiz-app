# Quiz en vivo

Aplicación de concursos de preguntas y respuestas en directo.
Un único administrador (con usuario y contraseña) crea el concurso y sus
preguntas, lo inicia y va avanzando pregunta a pregunta. Los concursantes
solo necesitan un nombre y el enlace del concurso para participar desde el
móvil. Al finalizar, se calcula la clasificación: **+1 punto por acierto**,
**−1 punto cada dos respuestas falladas**.

- **Frontend**: HTML/CSS/JS estático, alojado gratis en GitHub Pages.
- **Backend**: Google Apps Script (función de servidor gratuita de Google).
- **Base de datos**: una hoja de cálculo de Google Sheets.

No hace falta pagar ningún servicio ni mantener un servidor.

## Cómo funciona (resumen)

- El **administrador** entra en `admin.html`, inicia sesión, crea un concurso
  (esto genera una URL única tipo `play.html?c=mi-concurso`), añade preguntas
  con 4 opciones cada una y marca cuál es la correcta.
- Cuando todo está listo pulsa **Iniciar concurso** y comparte el enlace con
  los concursantes (QR, WhatsApp, proyectado en pantalla, etc.).
- Los **concursantes** abren el enlace, escriben su nombre y esperan. La
  pregunta aparece sola cuando el administrador la lanza; cada uno responde
  desde su propio móvil.
- El administrador controla el ritmo desde la pestaña **Control en vivo**
  (botón "Siguiente pregunta"). Cuando se acaban las preguntas, el concurso
  se marca como finalizado y se revela la clasificación a todos.

---

## 1. Crear la base de datos (Google Sheets + Apps Script)

1. Ve a [sheets.google.com](https://sheets.google.com) y crea una hoja de
   cálculo nueva en blanco. Ponle el nombre que quieras, por ejemplo
   "Quiz en vivo — datos".
2. Abre **Extensiones → Apps Script**.
3. Borra el contenido por defecto del archivo `Código.gs` y pega ahí todo
   el contenido del archivo [`apps-script/Code.gs`](apps-script/Code.gs)
   de este repositorio.
4. Guarda (icono de disco o `Ctrl/Cmd + S`).
5. En el menú superior, con la función `inicializar` seleccionada en el
   desplegable, pulsa **▶ Ejecutar**. La primera vez te pedirá autorizar
   permisos (es tu propio script accediendo a tu propia hoja: acepta los
   avisos de "aplicación no verificada" con tu cuenta). Esto crea
   automáticamente las pestañas `Concursos`, `Preguntas`, `Concursantes`
   y `Respuestas` en tu hoja de cálculo.
6. Configura las credenciales del administrador: en el editor de Apps
   Script ve a **Configuración del proyecto (icono de engranaje) →
   Propiedades del script → Añadir propiedad del script** y crea dos:
   - `ADMIN_USER` → el usuario que querrás usar para entrar al panel.
   - `ADMIN_PASS` → la contraseña correspondiente.

   (Guardarlas aquí, y no en una celda de la hoja, evita que cualquiera
   con acceso de lectura a la hoja pueda verlas.)

7. Despliega el script como aplicación web: **Implementar → Nueva
   implementación**. Tipo: **Aplicación web**. Configura:
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario**.

   Pulsa **Implementar**. La primera vez te pedirá autorizar un permiso
   adicional sobre **Google Drive**: el script lo usa para guardar ahí
   los logotipos que subas para cada concurso (crea una carpeta llamada
   "Quiz en vivo - logos" y la deja con acceso "cualquiera con el
   enlace puede ver", para que la imagen se pueda mostrar en la web
   pública). Acepta el aviso de "aplicación no verificada" con tu propia
   cuenta y copia la **URL de la aplicación web** que te da (termina en
   `/exec`). La necesitarás en el paso siguiente.

   > Cada vez que modifiques `Code.gs` más adelante tendrás que crear una
   > **nueva implementación** (o "Gestionar implementaciones → Editar →
   > Nueva versión") para que los cambios se publiquen.

## 2. Configurar el frontend

1. Abre [`assets/api.js`](assets/api.js) de este repositorio.
2. Sustituye el valor de `API_URL` por la URL `/exec` que copiaste en el
   paso anterior:

   ```js
   const CONFIG = {
     API_URL: "https://script.google.com/macros/s/XXXXXXXX/exec"
   };
   ```

## 3. Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub y sube todos los archivos de este
   proyecto (`index.html`, `admin.html`, `play.html`, la carpeta
   `assets/`, etc.) a la rama `main`.
2. En el repositorio, ve a **Settings → Pages**.
3. En "Source" elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
4. Guarda. GitHub te dará una URL pública, por ejemplo:
   `https://tu-usuario.github.io/tu-repositorio/`

¡Ya está! Comparte `https://tu-usuario.github.io/tu-repositorio/admin.html`
contigo mismo (es el panel) y, una vez creado cada concurso, el panel te
dará el enlace exacto para los concursantes.

---

## Estructura del proyecto

```
index.html          Página de bienvenida
admin.html           Panel del administrador (login, preguntas, control en vivo, resultados)
play.html             Vista del concursante (unirse, responder, ver resultado final)
assets/style.css      Estilos compartidos
assets/api.js         Conexión con el backend de Apps Script (pega aquí tu URL)
assets/admin.js       Lógica del panel admin
assets/play.js        Lógica de la vista del concursante
apps-script/Code.gs    Backend: lee y escribe en Google Sheets
```

## Decisiones de diseño a tener en cuenta

- **Una pregunta a la vez, en directo**: el administrador controla el
  ritmo manualmente (no hay temporizador automático por pregunta).
- **Sin revelar respuestas en directo**: los concursantes no saben si
  acertaron hasta que el concurso finaliza y se muestra la clasificación
  completa, para evitar que se chiven la respuesta entre ellos.
- **Puntuación**: `puntos = aciertos − ⌊fallos / 2⌋` (se resta 1 punto
  cada dos respuestas falladas; las preguntas sin responder no suman ni
  restan).
- **Preguntas fijas tras iniciar**: una vez pulsado "Iniciar concurso" no
  se pueden editar ni añadir/eliminar preguntas, para que la partida sea
  coherente para todos los concursantes.
- **Logotipo por concurso**: el administrador puede subir una imagen
  (PNG/JPG, máx. 2 MB) al crear el concurso o más adelante desde su
  ficha. Se guarda en una carpeta de Google Drive y se muestra a los
  concursantes en la pantalla de unirse, de espera, durante las
  preguntas y en los resultados finales. Cambiar el logo sustituye al
  anterior (el archivo viejo se envía a la papelera de Drive).
- **Un único administrador**: las credenciales se guardan como
  propiedades del script de Apps Script, no en la hoja de cálculo.

## Límites conocidos

- Google Apps Script tiene cuotas de uso gratuitas (ejecuciones por día,
  tiempo de ejecución, etc.) más que suficientes para un concurso en
  vivo con un grupo de gente, pero no está pensado para tráfico masivo.
- Los concursantes y el panel consultan el estado cada 2-2,5 segundos
  (sondeo), no hay actualización instantánea por WebSockets.
- Si ves errores de CORS al guardar `api.js`, vuelve a comprobar que has
  hecho una implementación nueva tras el último cambio en `Code.gs`.
