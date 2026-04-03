# WordPress + Elementor + WAB

This snippet works with Elementor pages and exposes actions without changing your theme files heavily.

## 1) Add WAB scripts

In WordPress (Elementor Custom Code or theme footer):

```html
<script src="https://webagentbridge.com/script/wab.min.js"></script>
<script src="https://webagentbridge.com/script/wab-schema.js"></script>
<script src="/wp-content/uploads/wab-elementor.js"></script>
```

## 2) Add this JS file as `wab-elementor.js`

```js
(function () {
  if (!window.WAB) return;

  var products = window.WABSchema ? window.WABSchema.scanJsonLd() : [];
  var suggested = window.WABSchema ? window.WABSchema.suggestActions(products) : [];

  var config = window.WABSchema
    ? window.WABSchema.mergeWithManual(
        {
          getHeroTitle: {
            description: 'Read Elementor hero heading',
            run: function () {
              var title = document.querySelector('.elementor-heading-title');
              return { title: title ? title.textContent.trim() : null };
            }
          },
          submitVisibleElementorForm: {
            description: 'Fill and submit the first visible Elementor form',
            run: function (params) {
              var form = document.querySelector('.elementor-form');
              if (!form) return { success: false, error: 'No Elementor form found' };

              var fields = form.querySelectorAll('input, textarea, select');
              fields.forEach(function (field) {
                var key = field.name || field.id;
                if (!key || params[key] == null) return;
                field.value = String(params[key]);
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
              });

              var submit = form.querySelector('[type="submit"], button');
              if (!submit) return { success: false, error: 'No submit button found' };
              submit.click();
              return { success: true };
            }
          }
        },
        suggested
      )
    : {
        actions: {
          getHeroTitle: {
            description: 'Read Elementor hero heading',
            run: function () {
              var title = document.querySelector('.elementor-heading-title');
              return { title: title ? title.textContent.trim() : null };
            }
          }
        }
      };

  window.WAB.init({
    name: document.title,
    actions: config.actions
  });
})();
```

This gives agents discoverable actions for Elementor content + schema-derived product helpers.
